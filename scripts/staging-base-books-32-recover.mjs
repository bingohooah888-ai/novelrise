import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  generateCoverMaskPng,
  resolveSourceCoverQuad
} from '../api/_lib/cover-mask-png.js';
import { inspectPng } from '../novelight-thumbnail-batch-import.js';

const PACK_KEY = 'NOVELIGHT_base_books_32_final';
const TEMPLATE_KEY = 'book-v1';
const PROD_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const PROD_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
const PROD_HOST = 'fiepaguycecrredwrcwx.supabase.co';
const EXPECTED_STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const BUCKET = 'novel-thumbnails';
const CONFIRMATION = 'RECOVER STAGING BASE BOOKS 32';

function fail(message) {
  throw new Error(`STAGING_BASE_BOOKS_32_RECOVERY_BLOCKED: ${message}`);
}

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) fail(`${key} is required.`);
  return value;
}

export function validateRecoveryEnvironment(env = process.env) {
  const stagingUrl = requiredEnv(env, 'STAGING_SUPABASE_URL');
  const secret = requiredEnv(env, 'STAGING_SUPABASE_SECRET_KEY');
  const confirmation = requiredEnv(env, 'RECOVERY_CONFIRMATION');
  if (confirmation !== CONFIRMATION)
    fail('confirmation does not match the approved recovery operation.');
  let parsed;
  try {
    parsed = new URL(stagingUrl);
  } catch {
    fail('STAGING_SUPABASE_URL is invalid.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== `${EXPECTED_STAGING_REF}.supabase.co` ||
    parsed.hostname === PROD_HOST ||
    parsed.username ||
    parsed.password
  ) {
    fail('refusing a non-canonical Staging Supabase target.');
  }
  if (!secret.startsWith('sb_secret_') && !secret.startsWith('eyJ')) {
    fail('STAGING_SUPABASE_SECRET_KEY is not a recognized server credential.');
  }
  return { stagingUrl: parsed.origin, secret };
}

export function validateProductionRows(rows, manifest) {
  if (!Array.isArray(rows) || rows.length !== 32)
    fail('Production source must expose exactly 32 official base books.');
  const byOrder = new Map();
  for (const row of rows) {
    const order = Number(row.sort_order);
    if (!Number.isInteger(order) || byOrder.has(order))
      fail('Production source display order is invalid or duplicated.');
    byOrder.set(order, row);
  }
  for (const item of manifest.items) {
    const row = byOrder.get(item.displayOrder);
    if (
      !row ||
      row.source_file_name !== item.fileName ||
      row.source_sha256 !== item.sha256 ||
      row.availability_status !== 'active' ||
      row.is_active !== true
    ) {
      fail(
        `Production source metadata mismatch at display order ${item.displayOrder}.`
      );
    }
    let url;
    try {
      url = new URL(row.image_url);
    } catch {
      fail(`Production source URL is invalid for ${item.fileName}.`);
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== PROD_HOST ||
      !url.pathname.startsWith(
        '/storage/v1/object/public/novel-thumbnails/official/'
      )
    ) {
      fail(
        `Production source URL escaped the public official thumbnail bucket for ${item.fileName}.`
      );
    }
  }
  return byOrder;
}

function sourceQuad(manifest) {
  const quad = manifest.sourceGeometry?.coverQuad;
  if (!quad) fail('manifest source geometry is missing.');
  return {
    top_left: quad.topLeft,
    top_right: quad.topRight,
    bottom_right: quad.bottomRight,
    bottom_left: quad.bottomLeft
  };
}

async function loadManifest() {
  const manifest = JSON.parse(
    await readFile(
      new URL('../novelight-base-books-32.json', import.meta.url),
      'utf8'
    )
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.packKey !== PACK_KEY ||
    manifest.templateKey !== TEMPLATE_KEY ||
    manifest.expectedPngCount !== 32 ||
    !Array.isArray(manifest.items) ||
    manifest.items.length !== 32 ||
    manifest.sourceGeometry?.width !== 1024 ||
    manifest.sourceGeometry?.height !== 1536
  ) {
    fail(
      'official 32-book manifest is not the canonical source-space manifest.'
    );
  }
  return manifest;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyOfficialBookBytes(bytes, item) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.byteLength !== item.size)
    fail(`byte size mismatch for ${item.fileName}.`);
  if (sha256(bytes) !== item.sha256)
    fail(`SHA-256 mismatch for ${item.fileName}.`);
  const png = inspectPng(new Uint8Array(bytes));
  if (
    png.width !== item.width ||
    png.height !== item.height ||
    png.bitDepth !== item.bitDepth ||
    png.colorType !== item.colorType ||
    png.compression !== 0 ||
    png.filter !== 0
  ) {
    fail(`PNG geometry mismatch for ${item.fileName}.`);
  }
  return true;
}

async function productionSources(prod, manifest) {
  const { data, error } = await prod
    .from('novel_thumbnail_assets')
    .select(
      'sort_order,source_file_name,source_sha256,image_url,availability_status,is_active,source_pack_key,layer_type,template_key'
    )
    .eq('source_pack_key', PACK_KEY)
    .eq('layer_type', 'base_book')
    .eq('template_key', TEMPLATE_KEY)
    .order('sort_order', { ascending: true });
  if (error) fail(`Production source lookup failed: ${error.message}`);
  return validateProductionRows(data, manifest);
}

async function downloadProductionBook(row, item) {
  const response = await fetch(row.image_url, { cache: 'no-store' });
  if (!response.ok)
    fail(
      `Production source download failed for ${item.fileName}: HTTP ${response.status}.`
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyOfficialBookBytes(bytes, item);
  return bytes;
}

function exactStagingRow(row, item) {
  return Boolean(
    row &&
    row.source_pack_key === PACK_KEY &&
    row.source_file_name === item.fileName &&
    row.source_sha256 === item.sha256 &&
    row.display_name_ja === item.displayNameJa &&
    row.material_ja === item.materialJa &&
    Number(row.sort_order) === item.displayOrder &&
    row.layer_type === 'base_book' &&
    row.template_key === TEMPLATE_KEY &&
    ['retired', 'active'].includes(row.availability_status)
  );
}

async function stagingRows(staging) {
  const { data, error } = await staging
    .from('novel_thumbnail_assets')
    .select(
      'id,label,storage_path,image_url,is_active,layer_type,template_key,sort_order,availability_status,display_name_ja,material_ja,source_pack_key,source_file_name,source_sha256'
    )
    .eq('source_pack_key', PACK_KEY)
    .order('sort_order', { ascending: true });
  if (error) fail(`Staging pack lookup failed: ${error.message}`);
  return data || [];
}

async function requireCanonicalTemplate(staging, manifest) {
  const { data, error } = await staging
    .from('novel_thumbnail_templates')
    .select(
      'template_key,canvas_width,canvas_height,cover_quad_space,base_book_source_width,base_book_source_height,cover_top_left_x,cover_top_left_y,cover_top_right_x,cover_top_right_y,cover_bottom_right_x,cover_bottom_right_y,cover_bottom_left_x,cover_bottom_left_y'
    )
    .eq('template_key', TEMPLATE_KEY)
    .single();
  if (error || !data)
    fail(
      `Staging book-v1 template lookup failed: ${error?.message || 'missing'}.`
    );
  const q = manifest.sourceGeometry.coverQuad;
  if (
    data.canvas_width !== 1086 ||
    data.canvas_height !== 1448 ||
    data.cover_quad_space !== 'base_book_source' ||
    data.base_book_source_width !== manifest.sourceGeometry.width ||
    data.base_book_source_height !== manifest.sourceGeometry.height ||
    data.cover_top_left_x !== q.topLeft.x ||
    data.cover_top_left_y !== q.topLeft.y ||
    data.cover_top_right_x !== q.topRight.x ||
    data.cover_top_right_y !== q.topRight.y ||
    data.cover_bottom_right_x !== q.bottomRight.x ||
    data.cover_bottom_right_y !== q.bottomRight.y ||
    data.cover_bottom_left_x !== q.bottomLeft.x ||
    data.cover_bottom_left_y !== q.bottomLeft.y
  ) {
    fail('Staging book-v1 source-space geometry is not canonical.');
  }
  return data;
}

async function validateExistingStagingRows(staging, rows, manifest) {
  if (rows.length > 32)
    fail('Staging contains more than 32 rows for the official pack.');
  const byFile = new Map();
  for (const row of rows) {
    if (byFile.has(row.source_file_name))
      fail(`duplicate Staging source file ${row.source_file_name}.`);
    byFile.set(row.source_file_name, row);
  }
  for (const item of manifest.items) {
    const row = byFile.get(item.fileName);
    if (!row) continue;
    if (!exactStagingRow(row, item))
      fail(`existing Staging metadata mismatch for ${item.fileName}.`);
    const { data, error } = await staging.storage
      .from(BUCKET)
      .download(row.storage_path);
    if (error || !data)
      fail(`existing Staging object is missing for ${item.fileName}.`);
    verifyOfficialBookBytes(Buffer.from(await data.arrayBuffer()), item);
  }
  return byFile;
}

async function precheck(staging, prod, manifest) {
  await requireCanonicalTemplate(staging, manifest);
  const sources = await productionSources(prod, manifest);
  const rows = await stagingRows(staging);
  await validateExistingStagingRows(staging, rows, manifest);
  const { error: rpcError } = await staging.rpc(
    'novelight_thumbnail_compositions_v3',
    { p_novel_ids: [] }
  );
  if (rpcError)
    fail(`Geometry v3 RPC is unavailable in Staging: ${rpcError.message}`);
  return { sources, rows };
}

export async function createRecoveryActor(staging, env = process.env) {
  const actorFile = requiredEnv(env, 'STAGING_RECOVERY_ACTOR_FILE');
  const runId = String(env.GITHUB_RUN_ID || 'local').replace(
    /[^0-9A-Za-z_-]/g,
    '-'
  );
  const email = `novelight-staging-recovery-${runId}-${randomUUID()}@example.com`;
  const password = `Nl!${randomUUID()}${randomUUID()}9a`;
  const { data, error } = await staging.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `NOVELIGHT Staging Recovery ${runId}` },
    app_metadata: { internal_staging_recovery: true, github_run_id: runId }
  });
  const userId = data?.user?.id;
  if (error || !userId) {
    fail(
      `failed to create ephemeral Staging recovery actor: ${error?.message || 'missing user id'}.`
    );
  }

  try {
    await writeFile(actorFile, JSON.stringify({ userId }), {
      encoding: 'utf8',
      mode: 0o600
    });
    const { data: foundingRows, error: foundingError } = await staging
      .from('founding_authors')
      .select('author_id')
      .eq('author_id', userId);
    if (foundingError) {
      fail(
        `failed to verify recovery actor isolation: ${foundingError.message}.`
      );
    }
    if ((foundingRows || []).length !== 0) {
      fail(
        'ephemeral Staging recovery actor unexpectedly received Founding Author state.'
      );
    }
    return { id: userId };
  } catch (actorError) {
    const cleanup = await staging.auth.admin.deleteUser(userId);
    if (cleanup.error && !/not found/i.test(cleanup.error.message || '')) {
      throw new Error(
        `${actorError.message}; recovery actor cleanup also failed: ${cleanup.error.message}`
      );
    }
    await unlink(actorFile).catch((unlinkError) => {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError;
    });
    throw actorError;
  }
}

export async function cleanupRecoveryActor(staging, env = process.env) {
  const actorFile = requiredEnv(env, 'STAGING_RECOVERY_ACTOR_FILE');
  let actor;
  try {
    actor = JSON.parse(await readFile(actorFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: false };
    fail(`failed to read ephemeral recovery actor state: ${error.message}.`);
  }
  const userId = String(actor?.userId || '').trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId
    )
  ) {
    fail('ephemeral recovery actor state contains an invalid user id.');
  }
  const result = await staging.auth.admin.deleteUser(userId);
  if (result.error && !/not found/i.test(result.error.message || '')) {
    fail(
      `failed to delete ephemeral Staging recovery actor: ${result.error.message}.`
    );
  }
  const { count, error: profileError } = await staging
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('id', userId);
  if (profileError) {
    fail(
      `failed to verify recovery actor profile cleanup: ${profileError.message}.`
    );
  }
  if (count !== 0) {
    fail(
      'ephemeral Staging recovery actor profile still exists after auth deletion.'
    );
  }
  await unlink(actorFile).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return { deleted: true };
}

async function stageBooks(staging, sources, manifest, auditUserId) {
  let rows = await stagingRows(staging);
  let byFile = await validateExistingStagingRows(staging, rows, manifest);
  for (const item of manifest.items) {
    if (byFile.has(item.fileName)) continue;
    const source = sources.get(item.displayOrder);
    const bytes = await downloadProductionBook(source, item);
    const storagePath = `official/${randomUUID()}.png`;
    const { error: uploadError } = await staging.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false
      });
    if (uploadError)
      fail(
        `Staging upload failed for ${item.fileName}: ${uploadError.message}`
      );
    const publicUrl = staging.storage.from(BUCKET).getPublicUrl(storagePath)
      .data?.publicUrl;
    if (!publicUrl?.startsWith('https://')) {
      await staging.storage.from(BUCKET).remove([storagePath]);
      fail(`Staging public URL was unavailable for ${item.fileName}.`);
    }
    const { error: stageError } = await staging.rpc(
      'novelight_admin_stage_official_base_book',
      {
        p_admin_user_id: auditUserId,
        p_display_name_ja: item.displayNameJa,
        p_material_ja: item.materialJa,
        p_storage_path: storagePath,
        p_image_url: publicUrl,
        p_template_key: TEMPLATE_KEY,
        p_display_order: item.displayOrder,
        p_source_pack_key: PACK_KEY,
        p_source_file_name: item.fileName,
        p_source_sha256: item.sha256
      }
    );
    if (stageError) {
      await staging.storage.from(BUCKET).remove([storagePath]);
      fail(
        `Staging stage RPC failed for ${item.fileName}: ${stageError.message}`
      );
    }
    rows = await stagingRows(staging);
    byFile = await validateExistingStagingRows(staging, rows, manifest);
  }
  if (byFile.size !== 32)
    fail('Staging stage phase did not produce exactly 32 verified rows.');
}

async function activatePack(staging, manifest, auditUserId) {
  const q = manifest.sourceGeometry.coverQuad;
  const resolved = resolveSourceCoverQuad(
    sourceQuad(manifest),
    manifest.sourceGeometry.width,
    manifest.sourceGeometry.height,
    1086,
    1448
  );
  const revision = randomUUID();
  const maskPath = `generated-masks/${TEMPLATE_KEY}/${revision}/${TEMPLATE_KEY}-cover-mask.png`;
  const mask = generateCoverMaskPng(resolved.coverQuad, 1086, 1448);
  const { error: maskError } = await staging.storage
    .from(BUCKET)
    .upload(maskPath, mask, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: false
    });
  if (maskError) fail(`Staging cover-mask upload failed: ${maskError.message}`);
  const maskUrl = staging.storage.from(BUCKET).getPublicUrl(maskPath)
    .data?.publicUrl;
  const { error } = await staging.rpc(
    'novelight_admin_activate_official_base_book_pack',
    {
      p_admin_user_id: auditUserId,
      p_source_pack_key: PACK_KEY,
      p_top_left_x: q.topLeft.x,
      p_top_left_y: q.topLeft.y,
      p_top_right_x: q.topRight.x,
      p_top_right_y: q.topRight.y,
      p_bottom_right_x: q.bottomRight.x,
      p_bottom_right_y: q.bottomRight.y,
      p_bottom_left_x: q.bottomLeft.x,
      p_bottom_left_y: q.bottomLeft.y,
      p_mask_revision: revision,
      p_mask_storage_path: maskPath,
      p_mask_url: maskUrl
    }
  );
  if (error) {
    await staging.storage.from(BUCKET).remove([maskPath]);
    fail(`Staging activation RPC failed: ${error.message}`);
  }
}

async function verifyReady(staging, manifest) {
  await requireCanonicalTemplate(staging, manifest);
  const rows = await stagingRows(staging);
  const byFile = await validateExistingStagingRows(staging, rows, manifest);
  if (rows.length !== 32 || byFile.size !== 32)
    fail('Staging official pack row count is not exactly 32.');
  for (const row of rows) {
    if (row.availability_status !== 'active' || row.is_active !== true) {
      fail(
        `Staging official pack is not fully active: ${row.source_file_name}.`
      );
    }
  }
  const { count: cachedCount, error: cachedError } = await staging
    .from('novel_thumbnail_compositions')
    .select('novel_id', { count: 'exact', head: true })
    .eq('template_key', TEMPLATE_KEY)
    .not('render_url', 'is', null);
  if (cachedError)
    fail(`Staging render-cache verification failed: ${cachedError.message}`);
  if (cachedCount !== 0)
    fail(`stale book-v1 render cache remains: ${cachedCount}.`);
  const { error: rpcError } = await staging.rpc(
    'novelight_thumbnail_compositions_v3',
    { p_novel_ids: [] }
  );
  if (rpcError)
    fail(`Geometry v3 RPC verification failed: ${rpcError.message}`);
  return { activeAssetCount: 32, staleRenderCount: 0 };
}

export async function runRecovery({
  mode = 'precheck',
  env = process.env
} = {}) {
  const { stagingUrl, secret } = validateRecoveryEnvironment(env);
  const manifest = await loadManifest();
  const staging = createClient(stagingUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const prod = createClient(PROD_URL, PROD_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (mode === 'verify') return verifyReady(staging, manifest);
  if (mode === 'cleanup-actor') return cleanupRecoveryActor(staging, env);
  const state = await precheck(staging, prod, manifest);
  if (mode === 'precheck') {
    return {
      productionSourceCount: state.sources.size,
      existingStagingCount: state.rows.length
    };
  }
  if (mode !== 'recover') fail(`unsupported mode ${mode}.`);
  const actor = await createRecoveryActor(staging, env);
  let recoveryResult;
  let recoveryError = null;
  try {
    await stageBooks(staging, state.sources, manifest, actor.id);
    await activatePack(staging, manifest, actor.id);
    recoveryResult = await verifyReady(staging, manifest);
  } catch (error) {
    recoveryError = error;
  }

  let cleanupError = null;
  try {
    await cleanupRecoveryActor(staging, env);
  } catch (error) {
    cleanupError = error;
  }

  if (recoveryError && cleanupError) {
    throw new Error(
      `${recoveryError.message}; ephemeral recovery actor cleanup also failed: ${cleanupError.message}`
    );
  }
  if (recoveryError) throw recoveryError;
  if (cleanupError) throw cleanupError;
  return recoveryResult;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : 'precheck';
  runRecovery({ mode })
    .then((result) =>
      console.log(
        `Staging base_book 32 ${mode}: PASS ${JSON.stringify(result)}`
      )
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
