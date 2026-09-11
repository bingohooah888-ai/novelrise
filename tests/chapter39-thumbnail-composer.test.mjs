import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260910220000_chapter39_thumbnail_composer.sql',
  'utf8'
);
const compat = await readFile(
  'supabase/migrations/20260910221000_chapter39_thumbnail_composer_compat.sql',
  'utf8'
);
const authorRead = await readFile(
  'supabase/migrations/20260910222000_chapter39_thumbnail_author_read.sql',
  'utf8'
);
const emergency = await readFile(
  'supabase/migrations/20260910223000_chapter39_thumbnail_emergency_guard.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260910220000_chapter39_thumbnail_composer_rollback.sql',
  'utf8'
);
const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');
const composerCss = await readFile('novelight-thumbnail-composer.css', 'utf8');
const publicRuntime = await readFile('novelight-thumbnail-runtime.js', 'utf8');
const publicCss = await readFile('novelight-thumbnails.css', 'utf8');
const post = await readFile('post.html', 'utf8');
const edit = await readFile('novel-edit.html', 'utf8');
const admin = await readFile('admin-thumbnails.html', 'utf8');
const adminApi = await readFile('api/_lib/admin-thumbnails.js', 'utf8');
const renderApi = await readFile('api/_lib/thumbnail-render.js', 'utf8');

const allMigrations = [migration, compat, authorRead, emergency].join('\n');

test('Chapter 39 stores seven official layer IDs at fixed 1086x1448 geometry', () => {
  assert.match(migration, /canvas_width integer not null default 1086/i);
  assert.match(migration, /canvas_height integer not null default 1448/i);
  for (const column of [
    'background_asset_id',
    'base_book_asset_id',
    'cover_asset_id',
    'pattern_asset_id',
    'symbol_asset_id',
    'frame_asset_id',
    'effect_asset_id'
  ]) {
    assert.ok(migration.includes(column), `missing ${column}`);
  }
  assert.match(migration, /background_asset_id uuid not null/i);
  assert.match(migration, /base_book_asset_id uuid not null/i);
  assert.match(migration, /cover_asset_id uuid not null/i);
  assert.match(migration, /pattern_asset_id uuid references/i);
  assert.match(migration, /effect_asset_id uuid references/i);
});

test('official material tables are RLS protected and browser writes stay closed', () => {
  assert.match(
    migration,
    /alter table public\.novel_thumbnail_templates enable row level security/i
  );
  assert.match(
    migration,
    /alter table public\.novel_thumbnail_compositions enable row level security/i
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_thumbnail_compositions from anon, authenticated/i
  );
  assert.match(
    migration,
    /grant select on table public\.novel_thumbnail_templates to anon, authenticated/i
  );
  assert.match(
    allMigrations,
    /grant execute on function public\.novelight_set_my_thumbnail_composition[\s\S]*to authenticated/i
  );
  assert.doesNotMatch(post, /type="file"[^>]*thumbnail/i);
  assert.doesNotMatch(edit, /type="file"[^>]*thumbnail/i);
});

test('legacy complete thumbnails remain compatible during rolling deployment', () => {
  assert.match(
    migration,
    /layer_type = coalesce\(layer_type, 'legacy_complete'\)/i
  );
  assert.match(
    compat,
    /alter column layer_type set default 'legacy_complete'/i
  );
  assert.match(
    compat,
    /alter column template_key set default 'legacy-complete-v1'/i
  );
  assert.ok(post.includes('loadLegacyThumbnails'));
  assert.ok(edit.includes('loadLegacyThumbnails'));
  assert.ok(edit.includes('レイヤー合成サムネイルへ切り替える'));
});

test('Chapter 40 supersedes the Chapter 39 mask render path while preserving internal debug masks', () => {
  assert.match(migration, /cover_mask_url text/i);
  assert.match(emergency, /cover_mask_url is not null/i);
  assert.match(emergency, /Thumbnail template is not composition-ready/);
  assert.ok(
    composer.includes("const SURFACE_TYPES = ['cover', 'pattern', 'symbol', 'frame']")
  );
  assert.ok(
    composer.includes(
      'for (const type of SURFACE_TYPES) await drawPerspectiveAsset(context, selected[type], quad)'
    )
  );
  assert.ok(!composer.includes("globalCompositeOperation = 'destination-in'"));
  assert.ok(!composer.includes('LABELS = Object.freeze({\n    cover_mask'));
});

test('cached render is derived WebP and source layer IDs remain canonical', () => {
  assert.match(migration, /novel-thumbnail-renders/i);
  assert.match(migration, /array\['image\/webp'\]/i);
  assert.match(compat, /\^renders\/\[0-9\]\+\/\[0-9a-f-\]\{36\}\\\.webp\$/i);
  assert.ok(composer.includes('canvas.toBlob('));
  assert.ok(composer.includes("'image/webp'"));
  assert.ok(
    composer.includes("client.rpc('novelight_set_my_thumbnail_composition'")
  );
  assert.ok(composer.includes('.uploadToSignedUrl('));
  assert.ok(renderApi.includes('supabase.auth.getUser(token)'));
  assert.ok(renderApi.includes('novelight_attach_thumbnail_render'));
});

test('emergency disable invalidates stale cached renders', () => {
  assert.match(emergency, /if v_status = 'emergency_disabled' then/i);
  assert.match(emergency, /render_storage_path = null/i);
  assert.match(emergency, /render_url = null/i);
  assert.match(emergency, /set thumbnail_url = null/i);
  assert.match(emergency, /availability_status <> 'emergency_disabled'/i);
});

test('ADMIN controls layer, template, order and publication state', () => {
  for (const text of [
    'レイヤー種別',
    '対応テンプレート',
    '表示順',
    '公開中',
    '選択終了',
    '緊急無効'
  ]) {
    assert.ok(admin.includes(text), `missing admin label ${text}`);
  }
  assert.ok(adminApi.includes("action === 'set-status'"));
  assert.ok(adminApi.includes('p_layer_type: layerType'));
  assert.ok(adminApi.includes('p_template_key: templateKey'));
  assert.ok(adminApi.includes('p_sort_order: sortOrder'));
});

test('author pages use layered composer while retaining safe fallback', () => {
  assert.ok(post.includes('novelight-thumbnail-composer.js'));
  assert.ok(post.includes('NovelightThumbnailComposer.mount'));
  assert.ok(post.includes('composerController.persist'));
  assert.ok(edit.includes('NovelightThumbnailComposer.mount'));
  assert.ok(edit.includes('composerController.persist'));
  assert.ok(edit.includes('composerController?.isDirty()'));
});

test('reader cards prefer one cached image and can rebuild missing cache from official layers', () => {
  assert.ok(publicRuntime.includes(".select('id,thumbnail_url')"));
  assert.ok(publicRuntime.includes('novelight_thumbnail_compositions'));
  assert.ok(publicRuntime.includes('novelight-cover-layer-group'));
  assert.ok(
    publicRuntime.includes("!link.querySelector('.novel-cover-image')")
  );
  assert.match(publicCss, /aspect-ratio:\s*3\s*\/\s*4/i);
  assert.match(composerCss, /aspect-ratio:3\/4/i);
});

test('rollback refuses destructive reversal after layered compositions are in use', () => {
  assert.match(
    rollback,
    /rollback refused: layered thumbnail compositions exist/i
  );
  assert.match(
    rollback,
    /rollback refused: novels without legacy thumbnail_asset_id exist/i
  );
  assert.match(rollback, /alter column thumbnail_asset_id set not null/i);
  assert.match(rollback, /Storage bucket is deliberately left in place/i);
});
