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
const FOUNDATION_PACK_KEY = 'NOVELIGHT_thumbnail_assets_v1_30';
const FOUNDATION_BACKGROUND = Object.freeze({
  key: 'background_studydesk_01',
  label: '書斎デスク背景 01',
  layerType: 'background',
  templateKey: TEMPLATE_KEY,
  sortOrder: 1000,
  size: 2534296,
  sha256: '045d9a2c660186b9292360c4ca14268bdb604c3779fe9d110fe2bb17c15e9917',
  width: 1086,
  height: 1448,
  bitDepth: 8,
  colorType: 2
});
const FOUNDATION_LAYER_TYPES = [
  'background',
  'cover',
  'pattern',
  'symbol',
  'frame',
  'effect'
];

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

async function loadFoundationManifest() {
  const manifest = JSON.parse(
    await readFile(
      new URL('../novelight-thumbnail-assets-v1.json', import.meta.url),
      'utf8'
    )
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.packKey !== FOUNDATION_PACK_KEY ||
    manifest.templateKey !== TEMPLATE_KEY ||
    manifest.expectedPngCount !== 30 ||
    !Array.isArray(manifest.items) ||
    manifest.items.length !== 30
  ) {
    fail('official thumbnail v1 manifest is not canonical.');
  }
  const items = [FOUNDATION_BACKGROUND];
  const seen = new Set([FOUNDATION_BACKGROUND.key]);
  for (const raw of manifest.items) {
    if (
      !raw ||
      typeof raw.key !== 'string' ||
      seen.has(raw.key) ||
      !FOUNDATION_LAYER_TYPES.includes(raw.layerType) ||
      raw.templateKey !== TEMPLATE_KEY ||
      !Number.isInteger(raw.sortOrder) ||
      !Number.isInteger(raw.size) ||
      !/^[0-9a-f]{64}$/u.test(raw.sha256) ||
      raw.width !== 1024 ||
      raw.height !== 1536 ||
      raw.bitDepth !== 8 ||
      raw.colorType !== 6
    ) {
      fail(
        'official thumbnail v1 manifest contains invalid foundation metadata.'
      );
    }
    seen.add(raw.key);
    items.push({
      key: raw.key,
      label: raw.label,
      layerType: raw.layerType,
      templateKey: raw.templateKey,
      sortOrder: raw.sortOrder,
      size: raw.size,
      sha256: raw.sha256,
      width: raw.width,
      height: raw.height,
      bitDepth: raw.bitDepth,
      colorType: raw.colorType
    });
  }
  if (items.length !== 31)
    fail('foundation recovery manifest must contain 31 assets.');
  return { packKey: FOUNDATION_PACK_KEY, items };
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

export function verifyFoundationBytes(bytes, item) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.byteLength !== item.size)
    fail(`foundation byte size mismatch for ${item.label}.`);
  if (sha256(bytes) !== item.sha256)
    fail(`foundation SHA-256 mismatch for ${item.label}.`);
  const png = inspectPng(new Uint8Array(bytes));
  if (
    png.width !== item.width ||
    png.height !== item.height ||
    png.bitDepth !== item.bitDepth ||
    png.colorType !== item.colorType ||
    png.compression !== 0 ||
    png.filter !== 0
  ) {
    fail(`foundation PNG geometry mismatch for ${item.label}.`);
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

async function validateProductionBookBinaries(sources, manifest) {
  for (const item of manifest.items) {
    const source = sources.get(item.displayOrder);
    if (!source) fail(`Production source is missing for ${item.fileName}.`);
    await downloadProductionBook(source, item);
  }
}

function stagingPublicUrl(staging, storagePath) {
  const publicUrl = staging.storage.from(BUCKET).getPublicUrl(storagePath)
    .data?.publicUrl;
  let parsed;
  try {
    parsed = new URL(publicUrl);
  } catch {
    fail(`Staging public URL is invalid for ${storagePath}.`);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== `${EXPECTED_STAGING_REF}.supabase.co` ||
    !parsed.pathname.startsWith(
      '/storage/v1/object/public/novel-thumbnails/official/'
    )
  ) {
    fail(
      `Staging public URL escaped the dedicated thumbnail bucket for ${storagePath}.`
    );
  }
  return publicUrl;
}

async function downloadStagingObject(staging, storagePath, label) {
  const { data, error } = await staging.storage
    .from(BUCKET)
    .download(storagePath);
  if (error || !data)
    fail(
      `Staging Storage object is unavailable for ${label}: ${error?.message || 'missing'}.`
    );
  return Buffer.from(await data.arrayBuffer());
}

function exactFoundationRow(row, item, storagePath) {
  return Boolean(
    row &&
    row.label === item.label &&
    row.layer_type === item.layerType &&
    row.template_key === item.templateKey &&
    Number(row.sort_order) === item.sortOrder &&
    row.availability_status === 'active' &&
    row.is_active === true &&
    row.storage_path === storagePath &&
    row.image_url ===
      `https://${EXPECTED_STAGING_REF}.supabase.co/storage/v1/object/public/novel-thumbnails/${storagePath}` &&
    row.source_pack_key == null &&
    row.source_file_name == null &&
    row.source_sha256 == null
  );
}

async function foundationRows(staging) {
  const { data, error } = await staging
    .from('novel_thumbnail_assets')
    .select(
      'id,label,storage_path,image_url,is_active,created_by,layer_type,template_key,sort_order,availability_status,source_pack_key,source_file_name,source_sha256'
    )
    .eq('template_key', TEMPLATE_KEY)
    .in('layer_type', FOUNDATION_LAYER_TYPES)
    .order('sort_order', { ascending: true });
  if (error) fail(`Staging foundation asset lookup failed: ${error.message}`);
  return data || [];
}

async function listStagingOfficialObjects(staging) {
  const objects = [];
  const limit = 100;
  for (let page = 0; page < 10; page += 1) {
    const { data, error } = await staging.storage
      .from(BUCKET)
      .list('official', {
        limit,
        offset: page * limit,
        sortBy: { column: 'name', order: 'asc' }
      });
    if (error)
      fail(`Staging official Storage listing failed: ${error.message}`);
    const rows = data || [];
    objects.push(...rows.filter((row) => row?.name && row.id !== null));
    if (rows.length < limit) return objects;
  }
  fail('Staging official Storage listing exceeded the bounded recovery scan.');
}

async function auditOfficialStorageObjects(
  staging,
  foundationState,
  rows,
  manifest,
  foundation
) {
  const objects = await listStagingOfficialObjects(staging);
  const referencedPaths = new Set([
    ...[...foundationState.entries.values()].map((entry) => entry.storagePath),
    ...rows.map((row) => row.storage_path)
  ]);
  const expectedByHash = new Map();
  const expectedSizes = new Set();
  for (const item of foundation.items) {
    if (expectedByHash.has(item.sha256))
      fail(`canonical Storage audit has duplicate SHA-256 ${item.sha256}.`);
    expectedByHash.set(item.sha256, { kind: 'foundation', item });
    expectedSizes.add(item.size);
  }
  for (const item of manifest.items) {
    if (expectedByHash.has(item.sha256))
      fail(`canonical Storage audit has duplicate SHA-256 ${item.sha256}.`);
    expectedByHash.set(item.sha256, { kind: 'base_book', item });
    expectedSizes.add(item.size);
  }

  const retryBookPaths = new Map();
  let foundationRetryObjectCount = 0;
  let baseBookRetryObjectCount = 0;
  let unknownOfficialObjectCount = 0;
  for (const object of objects) {
    const storagePath = `official/${object.name}`;
    if (referencedPaths.has(storagePath)) continue;
    const listedSize = Number(object.metadata?.size);
    if (
      !/[.]png$/iu.test(object.name) ||
      (Number.isFinite(listedSize) &&
        listedSize > 0 &&
        !expectedSizes.has(listedSize))
    ) {
      unknownOfficialObjectCount += 1;
      continue;
    }
    const bytes = await downloadStagingObject(
      staging,
      storagePath,
      `unreferenced official object ${object.name}`
    );
    const match = expectedByHash.get(sha256(bytes));
    if (!match) {
      unknownOfficialObjectCount += 1;
      continue;
    }
    if (match.kind === 'foundation') {
      verifyFoundationBytes(bytes, match.item);
      foundationRetryObjectCount += 1;
      continue;
    }
    verifyOfficialBookBytes(bytes, match.item);
    baseBookRetryObjectCount += 1;
    const paths = retryBookPaths.get(match.item.fileName) || [];
    paths.push(storagePath);
    paths.sort();
    retryBookPaths.set(match.item.fileName, paths);
  }

  return {
    officialStorageObjectCount: objects.length,
    referencedOfficialStorageObjectCount: referencedPaths.size,
    foundationRetryObjectCount,
    baseBookRetryObjectCount,
    unknownOfficialObjectCount,
    retryBookPaths
  };
}

async function resolveFoundationState(staging, foundation) {
  const rows = await foundationRows(staging);
  const entries = new Map();
  const expectedByHash = new Map();
  const expectedSizes = new Set();
  for (const item of foundation.items) {
    if (expectedByHash.has(item.sha256))
      fail(
        `foundation manifest contains a duplicate SHA-256 for ${item.label}.`
      );
    expectedByHash.set(item.sha256, item);
    expectedSizes.add(item.size);
  }

  for (const item of foundation.items) {
    const matches = rows.filter(
      (row) =>
        row.label === item.label &&
        row.layer_type === item.layerType &&
        row.template_key === item.templateKey
    );
    if (matches.length > 1)
      fail(`Staging contains duplicate foundation rows for ${item.label}.`);
    if (matches.length === 1) {
      const row = matches[0];
      const bytes = await downloadStagingObject(
        staging,
        row.storage_path,
        item.label
      );
      verifyFoundationBytes(bytes, item);
      if (!exactFoundationRow(row, item, row.storage_path))
        fail(
          `existing Staging foundation metadata mismatch for ${item.label}.`
        );
      entries.set(item.key, { item, row, storagePath: row.storage_path });
    }
  }

  const missing = foundation.items.filter((item) => !entries.has(item.key));
  if (missing.length) {
    const missingHashes = new Set(missing.map((item) => item.sha256));
    const candidates = await listStagingOfficialObjects(staging);
    for (const object of candidates) {
      const storagePath = `official/${object.name}`;
      if (
        [...entries.values()].some((entry) => entry.storagePath === storagePath)
      )
        continue;
      const listedSize = Number(object.metadata?.size);
      if (
        Number.isFinite(listedSize) &&
        listedSize > 0 &&
        !expectedSizes.has(listedSize)
      ) {
        continue;
      }
      if (!/[.]png$/iu.test(object.name)) continue;
      const bytes = await downloadStagingObject(
        staging,
        storagePath,
        object.name
      );
      const hash = sha256(bytes);
      if (!missingHashes.has(hash)) continue;
      const item = expectedByHash.get(hash);
      verifyFoundationBytes(bytes, item);
      if (entries.has(item.key))
        fail(
          `multiple Staging Storage objects match foundation asset ${item.label}.`
        );
      entries.set(item.key, { item, row: null, storagePath });
    }
  }

  for (const item of foundation.items) {
    if (!entries.has(item.key))
      fail(
        `Staging Storage is missing canonical foundation asset ${item.label}.`
      );
  }
  return {
    rows,
    entries,
    existingCount: [...entries.values()].filter((entry) => entry.row).length
  };
}

async function listRecoveryActors(staging) {
  const matches = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await staging.auth.admin.listUsers({
      page,
      perPage: 1000
    });
    if (error) fail(`Staging recovery actor audit failed: ${error.message}`);
    const users = data?.users || [];
    matches.push(
      ...users.filter(
        (user) =>
          String(
            user?.app_metadata?.internal_staging_recovery || ''
          ).toLowerCase() === 'true'
      )
    );
    if (users.length < 1000) break;
    if (page === 20)
      fail('Staging recovery actor audit exceeded bounded pagination.');
  }
  return matches;
}

async function assertNoRecoveryActors(staging) {
  const matches = await listRecoveryActors(staging);
  if (matches.length)
    fail(`Staging contains ${matches.length} leftover recovery actor(s).`);
}

export async function cleanupStaleRecoveryActors(staging) {
  const matches = await listRecoveryActors(staging);
  for (const user of matches) {
    const email = String(user?.email || '');
    const internalE2e =
      String(user?.app_metadata?.internal_e2e || '').toLowerCase() === 'true';
    if (
      !internalE2e ||
      !email.startsWith('novelight-staging-recovery-') ||
      !email.endsWith('@example.com')
    ) {
      fail('refusing to delete a recovery-marked user without exact internal identity markers.');
    }
    const result = await staging.auth.admin.deleteUser(user.id);
    if (result.error && !/not found/i.test(result.error.message || '')) {
      fail(`failed to delete stale Staging recovery actor: ${result.error.message}.`);
    }
  }
  await assertNoRecoveryActors(staging);
  return matches.length;
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
      'id,label,storage_path,image_url,is_active,created_by,layer_type,template_key,sort_order,availability_status,display_name_ja,material_ja,source_pack_key,source_file_name,source_sha256'
    )
    .eq('source_pack_key', PACK_KEY)
    .order('sort_order', { ascending: true });
  if (error) fail(`Staging pack lookup failed: ${error.message}`);
  return data || [];
}

async function stagingBookRow(staging, item) {
  const { data, error } = await staging
    .from('novel_thumbnail_assets')
    .select(
      'id,label,storage_path,image_url,is_active,created_by,layer_type,template_key,sort_order,availability_status,display_name_ja,material_ja,source_pack_key,source_file_name,source_sha256'
    )
    .eq('source_pack_key', PACK_KEY)
    .eq('source_file_name', item.fileName)
    .limit(2);
  if (error)
    fail(
      `Staging base_book lookup failed for ${item.fileName}: ${error.message}`
    );
  if ((data || []).length > 1)
    fail(`duplicate Staging source file ${item.fileName}.`);
  return data?.[0] || null;
}

async function verifyStagingBookRow(
  staging,
  row,
  item,
  { verifyBinary = true } = {}
) {
  if (!exactStagingRow(row, item))
    fail(`existing Staging metadata mismatch for ${item.fileName}.`);
  if (verifyBinary) {
    const bytes = await downloadStagingObject(
      staging,
      row.storage_path,
      item.fileName
    );
    verifyOfficialBookBytes(bytes, item);
  }
  return row;
}

async function requireCanonicalTemplate(staging, manifest) {
  const { data, error } = await staging
    .from('novel_thumbnail_templates')
    .select(
      'template_key,canvas_width,canvas_height,cover_quad_space,base_book_source_width,base_book_source_height,cover_top_left_x,cover_top_left_y,cover_top_right_x,cover_top_right_y,cover_bottom_right_x,cover_bottom_right_y,cover_bottom_left_x,cover_bottom_left_y,cover_mask_source,cover_mask_revision,cover_mask_storage_path,cover_mask_url'
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
    data.cover_bottom_left_y !== q.bottomLeft.y ||
    data.cover_mask_source !== 'cover_quad'
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
    await verifyStagingBookRow(staging, row, item);
  }
  return byFile;
}

async function precheck(staging, prod, manifest, foundation) {
  await requireCanonicalTemplate(staging, manifest);
  const recoveryActors = await listRecoveryActors(staging);
  const sources = await productionSources(prod, manifest);
  await validateProductionBookBinaries(sources, manifest);
  const foundationState = await resolveFoundationState(staging, foundation);
  const rows = await stagingRows(staging);
  await validateExistingStagingRows(staging, rows, manifest);
  const storageAudit = await auditOfficialStorageObjects(
    staging,
    foundationState,
    rows,
    manifest,
    foundation
  );
  const { error: rpcError } = await staging.rpc(
    'novelight_thumbnail_compositions_v3',
    { p_novel_ids: [] }
  );
  if (rpcError)
    fail(`Geometry v3 RPC is unavailable in Staging: ${rpcError.message}`);
  return {
    sources,
    rows,
    foundationState,
    storageAudit,
    staleRecoveryActorCount: recoveryActors.length
  };
}

async function countBy(staging, table, column, value, label) {
  const { count, error } = await staging
    .from(table)
    .select(column, { count: 'exact', head: true })
    .eq(column, value);
  if (error) fail(`${label} verification failed: ${error.message}`);
  return count || 0;
}

export async function createRecoveryActor(staging, env = process.env) {
  const actorFile = requiredEnv(env, 'STAGING_RECOVERY_ACTOR_FILE');
  const runId = String(env.GITHUB_RUN_ID || 'local').replace(
    /[^0-9A-Za-z_-]/g,
    '-'
  );
  const email = `novelight-staging-recovery-${runId}-${randomUUID()}@example.com`;
  const password = `Nl!${randomUUID()}9a`;
  const { data, error } = await staging.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `NOVELIGHT Staging Recovery ${runId}` },
    app_metadata: {
      internal_e2e: true,
      internal_staging_recovery: true,
      github_run_id: runId
    }
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
    if (
      (await countBy(
        staging,
        'founding_authors',
        'author_id',
        userId,
        'recovery actor Founding Author isolation'
      )) !== 0
    ) {
      fail(
        'ephemeral Staging recovery actor unexpectedly received Founding Author state.'
      );
    }
    if (
      (await countBy(
        staging,
        'beta_participants',
        'auth_user_id',
        userId,
        'recovery actor beta-participant isolation'
      )) !== 0
    ) {
      fail(
        'ephemeral Staging recovery actor unexpectedly received beta participation state.'
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
  const cleanupChecks = [
    ['profiles', 'id', 'profile'],
    ['founding_authors', 'author_id', 'Founding Author'],
    ['beta_participants', 'auth_user_id', 'beta participant'],
    ['novel_thumbnail_assets', 'created_by', 'thumbnail created_by']
  ];
  for (const [table, column, label] of cleanupChecks) {
    if (
      (await countBy(
        staging,
        table,
        column,
        userId,
        `recovery actor ${label}`
      )) !== 0
    ) {
      fail(
        `ephemeral Staging recovery actor ${label} state remains after auth deletion.`
      );
    }
  }
  await unlink(actorFile).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return { deleted: true };
}

async function foundationRowByStoragePath(staging, storagePath) {
  const { data, error } = await staging
    .from('novel_thumbnail_assets')
    .select(
      'id,label,storage_path,image_url,is_active,created_by,layer_type,template_key,sort_order,availability_status,display_name_ja,material_ja,source_pack_key,source_file_name,source_sha256'
    )
    .eq('storage_path', storagePath)
    .limit(2);
  if (error) fail(`Staging foundation row lookup failed: ${error.message}`);
  if ((data || []).length > 1)
    fail(`duplicate Staging foundation storage path ${storagePath}.`);
  return data?.[0] || null;
}

async function registerFoundationAssets(staging, foundationState, auditUserId) {
  for (const entry of foundationState.entries.values()) {
    if (entry.row) continue;
    const { item, storagePath } = entry;
    const imageUrl = stagingPublicUrl(staging, storagePath);
    const { error } = await staging.rpc(
      'novelight_admin_register_thumbnail_layer_asset',
      {
        p_admin_user_id: auditUserId,
        p_label: item.label,
        p_storage_path: storagePath,
        p_image_url: imageUrl,
        p_layer_type: item.layerType,
        p_template_key: item.templateKey,
        p_sort_order: item.sortOrder,
        p_status: 'active'
      }
    );
    const committed = await foundationRowByStoragePath(staging, storagePath);
    if (!exactFoundationRow(committed, item, storagePath)) {
      if (error)
        fail(
          `Staging foundation RPC failed for ${item.label}: ${error.message}`
        );
      fail(`Staging foundation registration did not persist ${item.label}.`);
    }
    const bytes = await downloadStagingObject(staging, storagePath, item.label);
    verifyFoundationBytes(bytes, item);
  }
}

async function stageBooks(
  staging,
  sources,
  manifest,
  auditUserId,
  storageAudit
) {
  const rows = await stagingRows(staging);
  const byFile = await validateExistingStagingRows(staging, rows, manifest);
  for (const item of manifest.items) {
    if (byFile.has(item.fileName)) continue;
    const reusablePaths = storageAudit.retryBookPaths.get(item.fileName) || [];
    const reusedStoragePath = reusablePaths[0] || null;
    const storagePath = reusedStoragePath || `official/${randomUUID()}.png`;
    const uploadedThisRun = reusedStoragePath == null;

    if (uploadedThisRun) {
      const source = sources.get(item.displayOrder);
      const bytes = await downloadProductionBook(source, item);
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
    }

    const publicUrl = stagingPublicUrl(staging, storagePath);
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

    const committed = await stagingBookRow(staging, item);
    if (committed && exactStagingRow(committed, item)) {
      await verifyStagingBookRow(staging, committed, item, {
        verifyBinary: false
      });
      if (uploadedThisRun && committed.storage_path !== storagePath) {
        const removal = await staging.storage.from(BUCKET).remove([storagePath]);
        if (removal.error)
          fail(
            `failed to remove this-run unreferenced object for ${item.fileName}: ${removal.error.message}`
          );
      }
      byFile.set(item.fileName, committed);
      continue;
    }

    if (uploadedThisRun) {
      const removal = await staging.storage.from(BUCKET).remove([storagePath]);
      if (removal.error)
        fail(
          `failed to clean this-run uncommitted object for ${item.fileName}: ${removal.error.message}`
        );
    }
    if (stageError)
      fail(
        `Staging stage RPC failed for ${item.fileName}: ${stageError.message}`
      );
    fail(`Staging stage RPC returned without persisting ${item.fileName}.`);
  }

  const finalRows = await stagingRows(staging);
  const finalByFile = await validateExistingStagingRows(
    staging,
    finalRows,
    manifest
  );
  if (finalRows.length !== 32 || finalByFile.size !== 32)
    fail('Staging stage phase did not produce exactly 32 verified rows.');
}

async function readActivationState(staging, revision, maskPath, maskUrl) {
  const { data: template, error: templateError } = await staging
    .from('novel_thumbnail_templates')
    .select('cover_mask_revision,cover_mask_storage_path,cover_mask_url')
    .eq('template_key', TEMPLATE_KEY)
    .single();
  if (templateError || !template)
    fail(
      `Staging activation state lookup failed: ${templateError?.message || 'missing template'}.`
    );
  const { count, error: countError } = await staging
    .from('novel_thumbnail_assets')
    .select('id', { count: 'exact', head: true })
    .eq('source_pack_key', PACK_KEY)
    .eq('layer_type', 'base_book')
    .eq('template_key', TEMPLATE_KEY)
    .eq('availability_status', 'active')
    .eq('is_active', true);
  if (countError)
    fail(`Staging active base_book count failed: ${countError.message}`);
  const referencesMask =
    String(template.cover_mask_revision || '') === revision &&
    template.cover_mask_storage_path === maskPath &&
    template.cover_mask_url === maskUrl;
  return {
    template,
    activeCount: count || 0,
    referencesMask,
    committed: referencesMask && (count || 0) === 32
  };
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
  if (!maskUrl?.startsWith(`https://${EXPECTED_STAGING_REF}.supabase.co/`))
    fail('Staging cover-mask public URL is invalid.');

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

  const state = await readActivationState(staging, revision, maskPath, maskUrl);
  if (state.committed) return { revision, maskPath, maskUrl };
  if (!state.referencesMask) {
    const removal = await staging.storage.from(BUCKET).remove([maskPath]);
    if (removal.error)
      fail(`failed to clean uncommitted cover mask: ${removal.error.message}`);
  }
  if (error) fail(`Staging activation RPC failed: ${error.message}`);
  fail('Staging activation did not converge to 32 active base books.');
}

async function verifyActivatedTemplate(staging, template) {
  const revision = String(template.cover_mask_revision || '');
  const maskPath = String(template.cover_mask_storage_path || '');
  const maskUrl = String(template.cover_mask_url || '');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      revision
    ) ||
    maskPath !==
      `generated-masks/${TEMPLATE_KEY}/${revision}/${TEMPLATE_KEY}-cover-mask.png` ||
    maskUrl !==
      `https://${EXPECTED_STAGING_REF}.supabase.co/storage/v1/object/public/${BUCKET}/${maskPath}`
  ) {
    fail('Staging book-v1 cover-mask activation metadata is invalid.');
  }
  const bytes = await downloadStagingObject(
    staging,
    maskPath,
    'book-v1 cover mask'
  );
  const png = inspectPng(new Uint8Array(bytes));
  if (
    png.width !== 1086 ||
    png.height !== 1448 ||
    png.bitDepth !== 8 ||
    png.colorType !== 6 ||
    png.compression !== 0 ||
    png.filter !== 0
  ) {
    fail('Staging book-v1 cover-mask PNG geometry is invalid.');
  }
}

async function verifyReady(
  staging,
  manifest,
  foundation,
  { requireCreatedByNull = true } = {}
) {
  const template = await requireCanonicalTemplate(staging, manifest);
  await verifyActivatedTemplate(staging, template);

  const foundationState = await resolveFoundationState(staging, foundation);
  if (foundationState.entries.size !== 31)
    fail('Staging canonical foundation row count is not exactly 31.');
  for (const entry of foundationState.entries.values()) {
    if (!entry.row)
      fail(`Staging foundation row is missing for ${entry.item.label}.`);
    if (requireCreatedByNull && entry.row.created_by !== null)
      fail(
        `Staging foundation created_by was not cleared for ${entry.item.label}.`
      );
  }

  const rows = await stagingRows(staging);
  const byFile = await validateExistingStagingRows(staging, rows, manifest);
  if (rows.length !== 32 || byFile.size !== 32)
    fail('Staging official base_book row count is not exactly 32.');
  for (const row of rows) {
    if (row.availability_status !== 'active' || row.is_active !== true)
      fail(
        `Staging official pack is not fully active: ${row.source_file_name}.`
      );
    if (requireCreatedByNull && row.created_by !== null)
      fail(
        `Staging base_book created_by was not cleared: ${row.source_file_name}.`
      );
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
  if (requireCreatedByNull) await assertNoRecoveryActors(staging);
  return {
    canonicalAssetCount: 63,
    foundationAssetCount: 31,
    activeBaseBookCount: 32,
    staleRenderCount: 0
  };
}

export async function runRecovery({
  mode = 'precheck',
  env = process.env
} = {}) {
  const { stagingUrl, secret } = validateRecoveryEnvironment(env);
  const manifest = await loadManifest();
  const foundation = await loadFoundationManifest();
  const staging = createClient(stagingUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const prod = createClient(PROD_URL, PROD_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (mode === 'verify')
    return verifyReady(staging, manifest, foundation, {
      requireCreatedByNull: true
    });
  if (mode === 'cleanup-actor') return cleanupRecoveryActor(staging, env);
  const state = await precheck(staging, prod, manifest, foundation);
  if (mode === 'precheck') {
    return {
      productionSourceCount: state.sources.size,
      canonicalFoundationCount: state.foundationState.entries.size,
      existingFoundationRowCount: state.foundationState.existingCount,
      existingBaseBookCount: state.rows.length,
      staleRecoveryActorCount: state.staleRecoveryActorCount,
      officialStorageObjectCount:
        state.storageAudit.officialStorageObjectCount,
      referencedOfficialStorageObjectCount:
        state.storageAudit.referencedOfficialStorageObjectCount,
      foundationRetryObjectCount:
        state.storageAudit.foundationRetryObjectCount,
      baseBookRetryObjectCount:
        state.storageAudit.baseBookRetryObjectCount,
      unknownOfficialObjectCount:
        state.storageAudit.unknownOfficialObjectCount
    };
  }
  if (mode !== 'recover') fail(`unsupported mode ${mode}.`);

  await cleanupStaleRecoveryActors(staging);
  const actor = await createRecoveryActor(staging, env);
  let recoveryError = null;
  try {
    await registerFoundationAssets(staging, state.foundationState, actor.id);
    await stageBooks(
      staging,
      state.sources,
      manifest,
      actor.id,
      state.storageAudit
    );
    await activatePack(staging, manifest, actor.id);
    await verifyReady(staging, manifest, foundation, {
      requireCreatedByNull: false
    });
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
  return verifyReady(staging, manifest, foundation, {
    requireCreatedByNull: true
  });
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
