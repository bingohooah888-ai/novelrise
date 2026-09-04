import { randomUUID } from 'node:crypto';
import { requireAdmin } from './admin-auth.js';

const BUCKET = 'novel-thumbnails';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const CONTENT_TYPES = new Map([
  ['image/webp', 'webp'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg']
]);
const PATH_PATTERN = /^official\/([0-9a-f-]{36})\.(webp|png|jpg|jpeg)$/i;

function bodyObject(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function normalizeLabel(value) {
  const label = String(value ?? '').trim();
  return label.length >= 1 && label.length <= 80 ? label : null;
}

async function listAssets(supabase) {
  const { data, error } = await supabase
    .from('novel_thumbnail_assets')
    .select('id,label,storage_path,image_url,is_active,created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Thumbnail list failed: ${error.message}`);
  return data ?? [];
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
    return {
      status: 503,
      payload: { error: 'Upload could not be prepared' }
    };
  }

  return {
    status: 200,
    payload: {
      path,
      token: data.token,
      maxFileSize: MAX_FILE_SIZE
    }
  };
}

async function verifyStoredObject(supabase, path) {
  const match = path.match(PATH_PATTERN);
  if (!match) return false;

  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list('official', {
    limit: 20,
    search: fileName
  });
  if (error)
    throw new Error(`Thumbnail storage verification failed: ${error.message}`);
  return (data ?? []).some((entry) => entry.name === fileName);
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

export function createAdminThumbnailsHandler({ supabase, env = process.env }) {
  return async function adminThumbnailsHandler(req, res) {
    const adminUser = await requireAdmin({ req, res, supabase, env });
    if (!adminUser) return;

    try {
      if (req.method === 'GET') {
        res.status(200).json({ assets: await listAssets(supabase) });
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
      if (action === 'prepare-upload')
        result = await prepareUpload({ supabase, body });
      else if (action === 'finalize-upload') {
        result = await finalizeUpload({ supabase, adminUser, body });
      } else result = { status: 400, payload: { error: 'Invalid action' } };

      res.status(result.status).json(result.payload);
    } catch (error) {
      console.error('Admin thumbnail operation failed', error);
      res.status(500).json({ error: 'Thumbnail operation failed' });
    }
  };
}
