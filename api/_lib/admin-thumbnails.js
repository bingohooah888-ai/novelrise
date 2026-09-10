import { randomUUID } from 'node:crypto';
import { requireAdmin } from './admin-auth.js';
import { generateCoverMaskPng, normalizeCoverQuad } from './cover-mask-png.js';

const BUCKET = 'novel-thumbnails';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const CONTENT_TYPES = new Map([
  ['image/webp', 'webp'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg']
]);
const PATH_PATTERN = /^official\/([0-9a-f-]{36})\.(webp|png|jpg|jpeg)$/i;
const UPLOAD_LAYER_TYPES = new Set([
  'background',
  'base_book',
  'cover',
  'pattern',
  'symbol',
  'frame',
  'effect'
]);
const STATUSES = new Set(['active', 'retired', 'emergency_disabled']);
const TEMPLATE_FIELDS =
  'id,template_key,label,canvas_width,canvas_height,cover_mask_storage_path,cover_mask_url,cover_mask_source,cover_mask_revision,cover_top_left_x,cover_top_left_y,cover_top_right_x,cover_top_right_y,cover_bottom_right_x,cover_bottom_right_y,cover_bottom_left_x,cover_bottom_left_y,availability_status,created_at,updated_at';
const LEGACY_TEMPLATE_FIELDS =
  'id,template_key,label,canvas_width,canvas_height,cover_mask_storage_path,cover_mask_url,availability_status,created_at,updated_at';

function bodyObject(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function normalizeLabel(value) {
  const label = String(value ?? '').trim();
  return label.length >= 1 && label.length <= 80 ? label : null;
}

function normalizeTemplateKey(value) {
  const key = String(value ?? '').trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(key) ? key : null;
}

function normalizeSortOrder(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100000
    ? number
    : null;
}

function schemaUnavailable(error) {
  return ['42P01', '42703', '42883'].includes(error?.code);
}

function rawCoverQuad(body) {
  return {
    top_left: { x: body.topLeftX, y: body.topLeftY },
    top_right: { x: body.topRightX, y: body.topRightY },
    bottom_right: { x: body.bottomRightX, y: body.bottomRightY },
    bottom_left: { x: body.bottomLeftX, y: body.bottomLeftY }
  };
}

async function listLegacyAssets(supabase) {
  const { data, error } = await supabase
    .from('novel_thumbnail_assets')
    .select('id,label,storage_path,image_url,is_active,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Thumbnail list failed: ${error.message}`);
  return {
    composerReady: false,
    coverQuadReady: false,
    templates: [],
    assets: data ?? []
  };
}

async function listTemplates(supabase) {
  let result = await supabase
    .from('novel_thumbnail_templates')
    .select(TEMPLATE_FIELDS)
    .order('created_at', { ascending: true });
  if (result.error?.code === '42703') {
    result = await supabase
      .from('novel_thumbnail_templates')
      .select(LEGACY_TEMPLATE_FIELDS)
      .order('created_at', { ascending: true });
    if (!result.error)
      return { data: result.data ?? [], coverQuadReady: false };
  }
  if (result.error) throw result.error;
  return { data: result.data ?? [], coverQuadReady: true };
}

async function listLibrary(supabase) {
  let templateResult;
  try {
    templateResult = await listTemplates(supabase);
  } catch (error) {
    if (schemaUnavailable(error)) return listLegacyAssets(supabase);
    throw new Error(`Thumbnail template list failed: ${error.message}`);
  }

  const { data: assets, error: assetError } = await supabase
    .from('novel_thumbnail_assets')
    .select(
      'id,label,storage_path,image_url,is_active,layer_type,template_key,sort_order,availability_status,created_at'
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (assetError)
    throw new Error(`Thumbnail list failed: ${assetError.message}`);

  return {
    composerReady: true,
    coverQuadReady: templateResult.coverQuadReady,
    templates: templateResult.data,
    assets: assets ?? []
  };
}

async function prepareUpload({ supabase, body }) {
  const contentType = String(body.contentType ?? '').toLowerCase();
  const extension = CONTENT_TYPES.get(contentType);
  const fileSize = Number(body.fileSize);
  if (
    !extension ||
    !Number.isInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > MAX_FILE_SIZE
  ) {
    return { status: 400, payload: { error: 'Invalid thumbnail file' } };
  }

  const path = `official/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error('Signed thumbnail upload creation failed', error);
    return { status: 503, payload: { error: 'Upload could not be prepared' } };
  }
  return {
    status: 200,
    payload: { path, token: data.token, maxFileSize: MAX_FILE_SIZE }
  };
}

async function verifyStoredObject(supabase, path) {
  if (!PATH_PATTERN.test(path)) return false;
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list('official', {
    limit: 20,
    search: fileName
  });
  if (error)
    throw new Error(`Thumbnail storage verification failed: ${error.message}`);
  return (data ?? []).some((entry) => entry.name === fileName);
}

async function finalizeLegacyUpload({
  supabase,
  adminUser,
  label,
  path,
  imageUrl
}) {
  const { data, error } = await supabase.rpc(
    'novelight_admin_register_thumbnail_asset',
    {
      p_admin_user_id: adminUser.id,
      p_label: label,
      p_storage_path: path,
      p_image_url: imageUrl
    }
  );
  if (error) {
    if (error.code === '23505') {
      return {
        status: 409,
        payload: { error: 'Thumbnail was already registered' }
      };
    }
    throw new Error(`Thumbnail registration failed: ${error.message}`);
  }
  return {
    status: 201,
    payload: { asset: Array.isArray(data) ? data[0] : data }
  };
}

async function finalizeUpload({ supabase, adminUser, body }) {
  const label = normalizeLabel(body.label);
  const path = String(body.path ?? '').trim();
  if (!label || !PATH_PATTERN.test(path)) {
    return { status: 400, payload: { error: 'Invalid thumbnail metadata' } };
  }
  if (!(await verifyStoredObject(supabase, path))) {
    return {
      status: 409,
      payload: { error: 'Uploaded thumbnail was not found' }
    };
  }

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const imageUrl = publicData?.publicUrl;
  if (!imageUrl || !imageUrl.startsWith('https://')) {
    throw new Error('Thumbnail public URL could not be resolved');
  }

  const layerType = String(body.layerType ?? '').trim();
  if (!layerType) {
    return finalizeLegacyUpload({ supabase, adminUser, label, path, imageUrl });
  }

  const templateKey = normalizeTemplateKey(body.templateKey);
  const sortOrder = normalizeSortOrder(body.sortOrder ?? 1000);
  const assetStatus = String(body.status ?? 'active').trim();
  if (
    !UPLOAD_LAYER_TYPES.has(layerType) ||
    !templateKey ||
    sortOrder === null ||
    !STATUSES.has(assetStatus)
  ) {
    return {
      status: 400,
      payload: { error: 'Invalid thumbnail layer metadata' }
    };
  }

  const { data, error } = await supabase.rpc(
    'novelight_admin_register_thumbnail_layer_asset',
    {
      p_admin_user_id: adminUser.id,
      p_label: label,
      p_storage_path: path,
      p_image_url: imageUrl,
      p_layer_type: layerType,
      p_template_key: templateKey,
      p_sort_order: sortOrder,
      p_status: assetStatus
    }
  );
  if (error) {
    if (schemaUnavailable(error)) {
      return {
        status: 503,
        payload: { error: 'Thumbnail composer schema is not ready' }
      };
    }
    if (error.code === '23505') {
      return {
        status: 409,
        payload: { error: 'Thumbnail was already registered' }
      };
    }
    throw new Error(`Thumbnail layer registration failed: ${error.message}`);
  }
  return {
    status: 201,
    payload: { asset: Array.isArray(data) ? data[0] : data }
  };
}

async function setAssetStatus({ supabase, adminUser, body }) {
  const assetId = String(body.assetId ?? '').trim();
  const assetStatus = String(body.status ?? '').trim();
  if (!/^[0-9a-f-]{36}$/iu.test(assetId) || !STATUSES.has(assetStatus)) {
    return {
      status: 400,
      payload: { error: 'Invalid thumbnail status request' }
    };
  }
  const { data, error } = await supabase.rpc(
    'novelight_admin_set_thumbnail_asset_status',
    {
      p_admin_user_id: adminUser.id,
      p_asset_id: assetId,
      p_status: assetStatus
    }
  );
  if (error) {
    if (schemaUnavailable(error)) {
      return {
        status: 503,
        payload: { error: 'Thumbnail composer schema is not ready' }
      };
    }
    throw new Error(`Thumbnail status update failed: ${error.message}`);
  }
  return {
    status: 200,
    payload: { asset: Array.isArray(data) ? data[0] : data }
  };
}

async function setTemplateCoverQuad({ supabase, adminUser, body }) {
  const templateKey = normalizeTemplateKey(body.templateKey);
  if (!templateKey)
    return { status: 400, payload: { error: 'Invalid template key' } };

  const { data: template, error: templateError } = await supabase
    .from('novel_thumbnail_templates')
    .select('template_key,canvas_width,canvas_height')
    .eq('template_key', templateKey)
    .maybeSingle();
  if (templateError) {
    if (schemaUnavailable(templateError)) {
      return {
        status: 503,
        payload: { error: 'Cover quad schema is not ready' }
      };
    }
    throw new Error(
      `Thumbnail template lookup failed: ${templateError.message}`
    );
  }
  if (!template)
    return { status: 404, payload: { error: 'Thumbnail template not found' } };

  let quad;
  try {
    quad = normalizeCoverQuad(
      rawCoverQuad(body),
      template.canvas_width,
      template.canvas_height
    );
  } catch (error) {
    return { status: 400, payload: { error: error.message } };
  }

  const revision = randomUUID();
  const fileName = `${templateKey}-cover-mask.png`;
  const path = `generated-masks/${templateKey}/${revision}/${fileName}`;
  const png = generateCoverMaskPng(
    quad,
    template.canvas_width,
    template.canvas_height
  );
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: false
    });
  if (uploadError)
    throw new Error(`Cover mask upload failed: ${uploadError.message}`);

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const maskUrl = publicData?.publicUrl;
  if (!maskUrl || !maskUrl.startsWith('https://')) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error('Cover mask public URL could not be resolved');
  }

  const { data, error } = await supabase.rpc(
    'novelight_admin_set_thumbnail_template_cover_quad',
    {
      p_admin_user_id: adminUser.id,
      p_template_key: templateKey,
      p_top_left_x: quad.top_left.x,
      p_top_left_y: quad.top_left.y,
      p_top_right_x: quad.top_right.x,
      p_top_right_y: quad.top_right.y,
      p_bottom_right_x: quad.bottom_right.x,
      p_bottom_right_y: quad.bottom_right.y,
      p_bottom_left_x: quad.bottom_left.x,
      p_bottom_left_y: quad.bottom_left.y,
      p_mask_revision: revision,
      p_mask_storage_path: path,
      p_mask_url: maskUrl
    }
  );
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    if (schemaUnavailable(error)) {
      return {
        status: 503,
        payload: { error: 'Cover quad schema is not ready' }
      };
    }
    throw new Error(`Cover quad update failed: ${error.message}`);
  }

  return {
    status: 200,
    payload: {
      template: data,
      mask: {
        fileName,
        path,
        url: maskUrl,
        width: template.canvas_width,
        height: template.canvas_height
      }
    }
  };
}

export function createAdminThumbnailsHandler({ supabase, env = process.env }) {
  return async function adminThumbnailsHandler(req, res) {
    const adminUser = await requireAdmin({ req, res, supabase, env });
    if (!adminUser) return;

    try {
      if (req.method === 'GET') {
        res.status(200).json(await listLibrary(supabase));
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const body = bodyObject(req);
      const action = String(body.action ?? '');
      let result;
      if (action === 'prepare-upload') {
        result = await prepareUpload({ supabase, body });
      } else if (action === 'finalize-upload') {
        result = await finalizeUpload({ supabase, adminUser, body });
      } else if (action === 'set-status') {
        result = await setAssetStatus({ supabase, adminUser, body });
      } else if (action === 'set-cover-quad') {
        result = await setTemplateCoverQuad({ supabase, adminUser, body });
      } else {
        result = { status: 400, payload: { error: 'Invalid action' } };
      }
      res.status(result.status).json(result.payload);
    } catch (error) {
      console.error('Admin thumbnail operation failed', error);
      res.status(500).json({ error: 'Thumbnail operation failed' });
    }
  };
}