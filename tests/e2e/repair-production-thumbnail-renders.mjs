import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const PRODUCTION_PROJECT = 'fiepaguycecrredwrcwx';
const CONFIRMATION = 'REPAIR_PRODUCTION_THUMBNAIL_RENDERS';
const RENDER_BUCKET = 'novel-thumbnail-renders';
const MAX_RENDER_SIZE = 2 * 1024 * 1024;
const APPLY = process.argv.includes('--apply');
const confirmation = process.argv
  .find((argument) => argument.startsWith('--confirm='))
  ?.slice('--confirm='.length);

if (APPLY && confirmation !== CONFIRMATION) {
  throw new Error(`Production repair requires --confirm=${CONFIRMATION}`);
}

const supabaseUrl = String(
  process.env.NOVELIGHT_COMMANDER_SUPABASE_URL || process.env.SUPABASE_URL || ''
).trim();
const serviceKey = String(
  process.env.NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
).trim();

if (!supabaseUrl || !serviceKey) {
  throw new Error('Production Supabase credentials are missing.');
}
if (!supabaseUrl.includes(PRODUCTION_PROJECT)) {
  throw new Error('Refusing to run against a non-Production Supabase project.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { data: missingRows, error: missingError } = await supabase
  .from('novel_thumbnail_compositions')
  .select('novel_id,revision')
  .is('render_url', null)
  .order('novel_id', { ascending: true })
  .limit(100);

if (missingError) {
  throw new Error(`Missing-render lookup failed: ${missingError.message}`);
}

const ids = (missingRows ?? []).map((row) => Number(row.novel_id));
if (!ids.length) {
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', missing: 0, repaired: 0 }));
  process.exit(0);
}

const { data: compositions, error: compositionError } = await supabase.rpc(
  'novelight_thumbnail_compositions_v3',
  { p_novel_ids: ids }
);
if (compositionError) {
  throw new Error(`Public composition lookup failed: ${compositionError.message}`);
}

const candidates = (compositions ?? []).filter(
  (composition) => !composition.render_url && ids.includes(Number(composition.novel_id))
);

if (!APPLY) {
  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        missingCompositions: ids.length,
        publicRepairCandidates: candidates.map((item) => Number(item.novel_id))
      },
      null,
      2
    )
  );
  process.exit(0);
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const composerPath = path.resolve(dirname, '../../novelight-thumbnail-composer.js');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ path: composerPath });

async function renderWebp(composition) {
  const dataUrl = await page.evaluate(async (input) => {
    const layerTypes = [
      'background',
      'base_book',
      'cover',
      'pattern',
      'symbol',
      'frame',
      'effect'
    ];
    const template = {
      template_key: input.template_key,
      canvas_width: Number(input.canvas_width),
      canvas_height: Number(input.canvas_height),
      availability_status: 'active',
      effect_allow_outside_cover: false,
      cover_mask_source: 'cover_quad',
      cover_quad_space: input.cover_quad_space || 'canvas',
      base_book_source_width: input.base_book_source_width ?? null,
      base_book_source_height: input.base_book_source_height ?? null,
      cover_top_left_x: input.cover_top_left_x,
      cover_top_left_y: input.cover_top_left_y,
      cover_top_right_x: input.cover_top_right_x,
      cover_top_right_y: input.cover_top_right_y,
      cover_bottom_right_x: input.cover_bottom_right_x,
      cover_bottom_right_y: input.cover_bottom_right_y,
      cover_bottom_left_x: input.cover_bottom_left_x,
      cover_bottom_left_y: input.cover_bottom_left_y
    };
    const assets = [];
    const selection = { template_key: input.template_key };
    for (const type of layerTypes) {
      const id = input[`${type}_asset_id`];
      const url = input[`${type}_url`];
      selection[`${type}_asset_id`] = id || null;
      if (!id || !url) continue;
      assets.push({
        id,
        image_url: url,
        layer_type: type,
        template_key: input.template_key,
        availability_status: 'active'
      });
    }
    const canvas = document.createElement('canvas');
    await window.NovelightThumbnailComposer.renderSelectionToCanvas({
      canvas,
      library: { templates: [template], assets },
      selection
    });
    return canvas.toDataURL('image/webp', 0.9);
  }, composition);

  const encoded = dataUrl.split(',', 2)[1];
  const bytes = Buffer.from(encoded || '', 'base64');
  if (!bytes.length || bytes.length > MAX_RENDER_SIZE) {
    throw new Error(`Rendered thumbnail size is invalid: ${bytes.length}`);
  }
  return bytes;
}

const repaired = [];
const skipped = [];
try {
  for (const composition of candidates) {
    const novelId = Number(composition.novel_id);
    const { data: current, error: currentError } = await supabase
      .from('novel_thumbnail_compositions')
      .select('revision,render_url')
      .eq('novel_id', novelId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current || current.render_url || current.revision !== composition.revision) {
      skipped.push(novelId);
      continue;
    }

    const bytes = await renderWebp(composition);
    const storagePath = `renders/${novelId}/${randomUUID()}.webp`;
    const upload = await supabase.storage.from(RENDER_BUCKET).upload(storagePath, bytes, {
      contentType: 'image/webp',
      upsert: false
    });
    if (upload.error) {
      throw new Error(`Render upload failed for novel ${novelId}: ${upload.error.message}`);
    }

    const publicUrl = supabase.storage.from(RENDER_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const attached = await supabase.rpc('novelight_attach_thumbnail_render', {
      p_novel_id: novelId,
      p_revision: composition.revision,
      p_storage_path: storagePath,
      p_render_url: publicUrl
    });
    if (attached.error || attached.data !== true) {
      await supabase.storage.from(RENDER_BUCKET).remove([storagePath]);
      throw new Error(
        `Render attach failed for novel ${novelId}: ${attached.error?.message || 'composition changed'}`
      );
    }
    repaired.push(novelId);
  }
} finally {
  await browser.close();
}

const { data: verification, error: verificationError } = await supabase
  .from('novel_thumbnail_compositions')
  .select('novel_id,render_url')
  .in('novel_id', repaired);
if (verificationError) throw verificationError;
const unresolved = (verification ?? [])
  .filter((row) => !row.render_url)
  .map((row) => Number(row.novel_id));
if (unresolved.length) {
  throw new Error(`Post-repair verification failed for: ${unresolved.join(', ')}`);
}

console.log(
  JSON.stringify(
    {
      mode: 'apply',
      missingCompositions: ids.length,
      publicRepairCandidates: candidates.length,
      repaired,
      skipped,
      result: 'SUCCESS'
    },
    null,
    2
  )
);
