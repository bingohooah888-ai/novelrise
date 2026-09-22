import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { createSecurityConfig } from '../tools/novelight-commander/src/security.js';
import { registerOfficialThumbnailPack } from '../tools/novelight-commander/src/thumbnail-register.js';

const CONFIRMATION = 'REGISTER_OFFICIAL_THUMBNAIL_PACK';
const manifestByFile = new Map([
  ['NOVELIGHT_background_official_v1.zip', 'novelight-thumbnail-background-v1.json'],
  ['NOVELIGHT_thumbnail_assets_v1_30.zip', 'novelight-thumbnail-assets-v1.json']
]);

const input = process.argv[2];
if (!input) throw new Error('Pack path is required.');

const absolute = path.resolve(input);
const fileName = path.basename(absolute);
const manifestPath = manifestByFile.get(fileName);
if (!manifestPath) throw new Error('Unsupported official thumbnail pack: ' + fileName);

const url = String(process.env.NOVELIGHT_COMMANDER_SUPABASE_URL || '').trim();
const key = String(process.env.NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('Production Supabase credentials are missing.');

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { data: adminRows, error: adminError } = await supabase
  .from('novel_thumbnail_assets')
  .select('created_by')
  .not('created_by', 'is', null)
  .order('created_at', { ascending: true })
  .limit(1);

if (adminError) {
  throw new Error('Could not resolve thumbnail admin identity: ' + adminError.message);
}
const adminUserId = String(adminRows?.[0]?.created_by || '');
if (!/^[0-9a-f-]{36}$/i.test(adminUserId)) {
  throw new Error('No existing thumbnail admin identity is available.');
}

process.env.NOVELIGHT_COMMANDER_ADMIN_USER_ID = adminUserId;

const security = createSecurityConfig({
  ...process.env,
  NOVELIGHT_COMMANDER_ROOT: process.cwd(),
  NOVELIGHT_COMMANDER_ALLOW_PRODUCTION: 'true'
});

const result = await registerOfficialThumbnailPack(
  path.relative(process.cwd(), absolute),
  manifestPath,
  CONFIRMATION,
  security
);

const manifest = JSON.parse(
  await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')
);
const failures = [];
for (const item of manifest.items || []) {
  const { data, error } = await supabase
    .from('novel_thumbnail_assets')
    .select('id,label,layer_type,template_key,availability_status,source_sha256')
    .eq('label', item.label)
    .eq('layer_type', item.layerType)
    .eq('template_key', item.templateKey)
    .eq('availability_status', 'active');

  if (error) {
    failures.push(item.label + ': ' + error.message);
    continue;
  }
  const exact = (data || []).filter(
    row => String(row.source_sha256 || '').toLowerCase() === String(item.sha256 || '').toLowerCase()
  );
  if (exact.length !== 1) {
    failures.push(item.label + ': expected exactly one active SHA-matching asset, got ' + exact.length);
  }
}

if (failures.length) {
  throw new Error('Post-registration verification failed:\n' + failures.join('\n'));
}

const layers = [...new Set((manifest.items || []).map(item => item.layerType))];
const activeCounts = {};
for (const layer of layers) {
  const { count, error } = await supabase
    .from('novel_thumbnail_assets')
    .select('id', { head: true, count: 'exact' })
    .eq('layer_type', layer)
    .eq('availability_status', 'active');
  if (error) throw new Error('Active count failed for ' + layer + ': ' + error.message);
  activeCounts[layer] = count;
}

console.log(JSON.stringify({
  packKey: result.packKey,
  total: result.total,
  registered: result.registered,
  skipped: result.skipped,
  activeCounts,
  verifiedItems: (manifest.items || []).length,
  result: 'SUCCESS'
}, null, 2));
