import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const OWNER = 'bingohooah888-ai';
const BUCKET = 'novel-thumbnails';
const CONFIRMATION = 'REGISTER_OFFICIAL_THUMBNAIL_PACK';
const REQUEST_ID_PATTERN = /^cmdr-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_LAYERS = new Set([
  'background',
  'base_book',
  'pattern',
  'symbol',
  'frame'
]);
const PACK_MANIFESTS = new Map([
  [
    'NOVELIGHT_background_official_v1.zip',
    'novelight-thumbnail-background-v1.json'
  ],
  [
    'NOVELIGHT_thumbnail_assets_v1_30.zip',
    'novelight-thumbnail-assets-v1.json'
  ]
]);

function headerValue(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : String(value || '').trim();
}

function bearerToken(req) {
  const authorization = headerValue(req, 'authorization');
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] || null;
}

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function verifyGithubOwner(token) {
  if (!token) return false;
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Production-Import'
    },
    cache: 'no-store'
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  return payload?.login === OWNER;
}

function productionClient(env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(
    env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();
  if (!url || !key) {
    throw new Error('Production Supabase configuration is unavailable.');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function loadManifest(packFileName) {
  const manifestFile = PACK_MANIFESTS.get(String(packFileName || ''));
  if (!manifestFile) {
    throw new Error('Unsupported official thumbnail pack.');
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(process.cwd(), manifestFile), 'utf8')
  );
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (!items.length) throw new Error('Canonical manifest has no items.');
  for (const item of items) {
    const layer = String(item.layerType || item.sourceCategory || '').trim();
    if (!ALLOWED_LAYERS.has(layer)) {
      throw new Error('Canonical manifest contains an unsupported layer.');
    }
  }
  return manifest;
}

function pngHeader(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    buffer.length < 33 ||
    signature.some((value, index) => buffer[index] !== value)
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25]
  };
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FILE_SIZE) {
      throw new Error('Thumbnail payload exceeds the size limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function validateBinary(bytes, item) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_FILE_SIZE) {
    throw new Error('Thumbnail binary size is invalid.');
  }
  if (Number(item.size) !== bytes.length) {
    throw new Error('Thumbnail byte size does not match the canonical manifest.');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (String(item.sha256 || '').toLowerCase() !== sha256) {
    throw new Error('Thumbnail SHA-256 does not match the canonical manifest.');
  }
  const png = pngHeader(bytes);
  if (!png) throw new Error('Thumbnail PNG header is invalid.');
  if (
    png.width !== Number(item.width) ||
    png.height !== Number(item.height) ||
    png.bitDepth !== Number(item.bitDepth) ||
    png.colorType !== Number(item.colorType)
  ) {
    throw new Error('Thumbnail PNG geometry does not match the canonical manifest.');
  }
  return sha256;
}

async function resolveAdminUserId(supabase, env) {
  const configured = String(env.NOVELIGHT_ADMIN_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => UUID_PATTERN.test(value));
  if (configured) return configured;

  const { data, error } = await supabase
    .from('novel_thumbnail_assets')
    .select('created_by')
    .not('created_by', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error('Thumbnail admin identity lookup failed.');
  const discovered = String(data?.[0]?.created_by || '').trim();
  if (!UUID_PATTERN.test(discovered)) {
    throw new Error('Thumbnail admin identity is unavailable.');
  }
  return discovered;
}

async function lookupExisting(supabase, item) {
  const layer = String(item.layerType || item.sourceCategory || '').trim();
  const template = String(item.templateKey || 'book-v1').trim();
  const label = String(item.label || item.displayName || item.key || '').trim();
  const sha256 = String(item.sha256 || '').toLowerCase();

  const { data: bySha, error: shaError } = await supabase
    .from('novel_thumbnail_assets')
    .select('id,label,source_sha256')
    .eq('layer_type', layer)
    .eq('template_key', template)
    .eq('source_sha256', sha256)
    .limit(2);
  if (shaError) throw new Error('Existing thumbnail SHA lookup failed.');
  if ((bySha || []).length > 0) {
    return { status: 'skipped_existing_sha', id: bySha[0].id };
  }

  const { data: byLabel, error: labelError } = await supabase
    .from('novel_thumbnail_assets')
    .select('id,label,source_sha256')
    .eq('layer_type', layer)
    .eq('template_key', template)
    .eq('label', label)
    .limit(2);
  if (labelError) throw new Error('Existing thumbnail label lookup failed.');
  if ((byLabel || []).length > 0) {
    return { status: 'conflict', id: byLabel[0].id };
  }
  return { status: 'missing', id: null };
}

async function readiness(supabase, manifest) {
  let missing = 0;
  let skipped = 0;
  let conflicts = 0;
  for (const item of manifest.items) {
    const existing = await lookupExisting(supabase, item);
    if (existing.status === 'missing') missing += 1;
    else if (existing.status === 'skipped_existing_sha') skipped += 1;
    else conflicts += 1;
  }

  const layers = [
    ...new Set(
      manifest.items.map((item) =>
        String(item.layerType || item.sourceCategory || '').trim()
      )
    )
  ];
  const activeCounts = {};
  for (const layer of layers) {
    const { count, error } = await supabase
      .from('novel_thumbnail_assets')
      .select('id', { head: true, count: 'exact' })
      .eq('layer_type', layer)
      .eq('availability_status', 'active');
    if (error) throw new Error('Active thumbnail count failed.');
    activeCounts[layer] = count;
  }
  return {
    packKey: manifest.packKey || null,
    items: manifest.items.length,
    missing,
    skipped,
    conflicts,
    activeCounts,
    ready: conflicts === 0
  };
}

async function registerOne({ supabase, adminUserId, manifest, item, bytes }) {
  const sha256 = validateBinary(bytes, item);
  const existing = await lookupExisting(supabase, item);
  if (existing.status === 'skipped_existing_sha') {
    return {
      key: item.key,
      label: item.label,
      status: 'skipped_existing_sha',
      id: existing.id
    };
  }
  if (existing.status === 'conflict') {
    const error = new Error(
      'Existing asset has the same label but a different canonical source.'
    );
    error.statusCode = 409;
    throw error;
  }

  const layerType = String(item.layerType || item.sourceCategory || '').trim();
  const templateKey = String(item.templateKey || manifest.templateKey || 'book-v1');
  const label = String(item.label || item.displayName || item.key || '').trim();
  const storagePath = 'official/' + randomUUID() + '.png';

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: 'image/png',
      upsert: false,
      cacheControl: '31536000'
    });
  if (uploadError) {
    throw new Error('Production Storage upload failed.');
  }

  const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data
    .publicUrl;
  const { data: registered, error: registerError } = await supabase.rpc(
    'novelight_admin_register_thumbnail_layer_asset',
    {
      p_admin_user_id: adminUserId,
      p_label: label,
      p_storage_path: storagePath,
      p_image_url: imageUrl,
      p_layer_type: layerType,
      p_template_key: templateKey,
      p_sort_order: Number(item.sortOrder ?? 1000),
      p_status: 'active'
    }
  );

  if (registerError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error('Production thumbnail DB registration failed.');
  }
  const row = Array.isArray(registered) ? registered[0] : registered;
  if (!row?.id) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error('Production thumbnail DB registration returned no id.');
  }

  const { error: metadataError } = await supabase
    .from('novel_thumbnail_assets')
    .update({
      display_name_ja: label,
      source_pack_key: String(manifest.packKey || ''),
      source_file_name: path.basename(String(item.path || '')),
      source_sha256: sha256
    })
    .eq('id', row.id);
  if (metadataError) {
    await supabase.from('novel_thumbnail_assets').delete().eq('id', row.id);
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error('Production thumbnail metadata update failed.');
  }

  return {
    key: item.key,
    label,
    status: 'registered',
    id: row.id,
    storagePath
  };
}

export function createCommanderThumbnailImportHandler({ env = process.env } = {}) {
  return async function commanderThumbnailImportHandler(req, res) {
    setSecurityHeaders(res);
    try {
      const token = bearerToken(req);
      if (!(await verifyGithubOwner(token))) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const supabase = productionClient(env);
      const packFileName =
        req.method === 'GET'
          ? String(req.query?.pack || '').trim()
          : headerValue(req, 'x-novelight-pack');
      const manifest = await loadManifest(packFileName);

      if (req.method === 'GET') {
        const state = await readiness(supabase, manifest);
        const adminUserId = await resolveAdminUserId(supabase, env);
        return res.status(200).json({
          ...state,
          adminIdentityReady: Boolean(adminUserId)
        });
      }

      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      if (headerValue(req, 'x-novelight-confirmation') !== CONFIRMATION) {
        return res.status(403).json({ error: 'Production confirmation required' });
      }
      const requestId = headerValue(req, 'x-novelight-request-id');
      if (!REQUEST_ID_PATTERN.test(requestId)) {
        return res.status(400).json({ error: 'Invalid Commander request id' });
      }

      const assetKey = headerValue(req, 'x-novelight-asset-key');
      const item = manifest.items.find((entry) => entry.key === assetKey);
      if (!item) {
        return res.status(400).json({ error: 'Unknown canonical asset key' });
      }

      const bytes = await readRawBody(req);
      const adminUserId = await resolveAdminUserId(supabase, env);
      const result = await registerOne({
        supabase,
        adminUserId,
        manifest,
        item,
        bytes
      });
      return res.status(result.status === 'registered' ? 201 : 200).json(result);
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      console.error('Commander thumbnail import failed', error?.message);
      return res.status(status).json({
        error:
          status >= 500
            ? 'Commander thumbnail import failed'
            : String(error?.message || 'Request failed')
      });
    }
  };
}
