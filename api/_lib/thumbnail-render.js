import { randomUUID } from 'node:crypto';

const RENDER_BUCKET = 'novel-thumbnail-renders';
const MAX_RENDER_SIZE = 2 * 1024 * 1024;
const PATH_PATTERN = /^renders\/([0-9]+)\/([0-9a-f-]{36})\.webp$/i;

function getBearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function bodyObject(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function normalizeNovelId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/u.test(text) ? text : null;
}

function normalizeRevision(value) {
  const text = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    text
  )
    ? text
    : null;
}

async function requireUser({ req, res, supabase }) {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return data.user;
}

async function loadOwnedComposition({ supabase, userId, novelId, revision }) {
  const { data: novel, error: novelError } = await supabase
    .from('novels')
    .select('id,user_id')
    .eq('id', novelId)
    .limit(1)
    .maybeSingle();

  if (novelError) throw new Error(`Novel lookup failed: ${novelError.message}`);
  if (!novel || novel.user_id !== userId) return null;

  const { data: composition, error: compositionError } = await supabase
    .from('novel_thumbnail_compositions')
    .select('novel_id,revision')
    .eq('novel_id', novelId)
    .eq('revision', revision)
    .limit(1)
    .maybeSingle();

  if (compositionError) {
    throw new Error(`Thumbnail composition lookup failed: ${compositionError.message}`);
  }
  return composition ?? null;
}

async function prepareUpload({ supabase, user, body }) {
  const novelId = normalizeNovelId(body.novelId);
  const revision = normalizeRevision(body.revision);
  const fileSize = Number(body.fileSize);
  if (
    !novelId ||
    !revision ||
    !Number.isInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > MAX_RENDER_SIZE
  ) {
    return { status: 400, payload: { error: 'Invalid thumbnail render request' } };
  }

  const composition = await loadOwnedComposition({
    supabase,
    userId: user.id,
    novelId,
    revision
  });
  if (!composition) {
    return { status: 409, payload: { error: 'Thumbnail composition changed' } };
  }

  const path = `renders/${novelId}/${randomUUID()}.webp`;
  const { data, error } = await supabase.storage
    .from(RENDER_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error('Thumbnail render signed upload creation failed', error);
    return { status: 503, payload: { error: 'Render upload could not be prepared' } };
  }

  return {
    status: 200,
    payload: { path, token: data.token, maxFileSize: MAX_RENDER_SIZE }
  };
}

async function verifyStoredObject(supabase, path) {
  const match = path.match(PATH_PATTERN);
  if (!match) return false;
  const novelId = match[1];
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const { data, error } = await supabase.storage
    .from(RENDER_BUCKET)
    .list(`renders/${novelId}`, { limit: 20, search: fileName });
  if (error) throw new Error(`Thumbnail render verification failed: ${error.message}`);
  return (data ?? []).some((entry) => entry.name === fileName);
}

async function finalizeUpload({ supabase, user, body }) {
  const novelId = normalizeNovelId(body.novelId);
  const revision = normalizeRevision(body.revision);
  const path = String(body.path ?? '').trim();
  const match = path.match(PATH_PATTERN);
  if (!novelId || !revision || !match || match[1] !== novelId) {
    return { status: 400, payload: { error: 'Invalid thumbnail render metadata' } };
  }

  const composition = await loadOwnedComposition({
    supabase,
    userId: user.id,
    novelId,
    revision
  });
  if (!composition) {
    return { status: 409, payload: { error: 'Thumbnail composition changed' } };
  }

  if (!(await verifyStoredObject(supabase, path))) {
    return { status: 409, payload: { error: 'Uploaded render was not found' } };
  }

  const { data: publicData } = supabase.storage
    .from(RENDER_BUCKET)
    .getPublicUrl(path);
  const renderUrl = publicData?.publicUrl;
  if (!renderUrl || !renderUrl.startsWith('https://')) {
    throw new Error('Thumbnail render public URL could not be resolved');
  }

  const { data, error } = await supabase.rpc('novelight_attach_thumbnail_render', {
    p_novel_id: novelId,
    p_revision: revision,
    p_storage_path: path,
    p_render_url: renderUrl
  });
  if (error) throw new Error(`Thumbnail render attach failed: ${error.message}`);
  if (data !== true) {
    return { status: 409, payload: { error: 'Thumbnail composition changed' } };
  }

  return { status: 200, payload: { renderUrl } };
}

export function createThumbnailRenderHandler({ supabase }) {
  return async function thumbnailRenderHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const user = await requireUser({ req, res, supabase });
    if (!user) return;

    try {
      const body = bodyObject(req);
      const action = String(body.action ?? '');
      let result;
      if (action === 'prepare-upload') {
        result = await prepareUpload({ supabase, user, body });
      } else if (action === 'finalize-upload') {
        result = await finalizeUpload({ supabase, user, body });
      } else {
        result = { status: 400, payload: { error: 'Invalid action' } };
      }
      res.status(result.status).json(result.payload);
    } catch (error) {
      console.error('Thumbnail render operation failed', error);
      res.status(500).json({ error: 'Thumbnail render operation failed' });
    }
  };
}
