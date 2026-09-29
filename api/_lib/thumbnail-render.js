import { randomUUID } from 'node:crypto';

const RENDER_BUCKET = 'novel-thumbnail-renders';
const RENDER_CONTENT_TYPE = 'image/webp';
const MAX_RENDER_SIZE = 2 * 1024 * 1024;
const PATH_PATTERN = /^renders\/([0-9]+)\/([0-9a-f-]{36})\.webp$/i;
const FAILURE_STAGES = new Set([
  'render',
  'prepare-upload',
  'upload',
  'finalize-upload',
  'unknown'
]);

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

function boundedText(value, maxLength) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength);
}

function normalizeMime(value) {
  return String(value ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

export function isWebpSignature(value) {
  let bytes;
  if (value instanceof Uint8Array) {
    bytes = value;
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    return false;
  }

  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
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

  if (novelError) {
    throw new Error(`Novel lookup failed: ${novelError.message}`);
  }
  if (!novel || novel.user_id !== userId) return null;

  const query = supabase
    .from('novel_thumbnail_compositions')
    .select('novel_id,revision')
    .eq('novel_id', novelId);
  if (revision) query.eq('revision', revision);
  const { data: composition, error: compositionError } = await query
    .limit(1)
    .maybeSingle();

  if (compositionError) {
    throw new Error(
      `Thumbnail composition lookup failed: ${compositionError.message}`
    );
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
    return {
      status: 400,
      payload: { error: 'Invalid thumbnail render request' }
    };
  }

  const composition = await loadOwnedComposition({
    supabase,
    userId: user.id,
    novelId,
    revision
  });
  if (!composition) {
    return {
      status: 409,
      payload: { error: 'Thumbnail composition changed' }
    };
  }

  const path = `renders/${novelId}/${randomUUID()}.webp`;
  const { data, error } = await supabase.storage
    .from(RENDER_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error('Thumbnail render signed upload creation failed', error);
    return {
      status: 503,
      payload: { error: 'Render upload could not be prepared' }
    };
  }

  return {
    status: 200,
    payload: {
      path,
      token: data.token,
      maxFileSize: MAX_RENDER_SIZE,
      contentType: RENDER_CONTENT_TYPE
    }
  };
}

async function inspectStoredWebpObject(supabase, path) {
  const match = path.match(PATH_PATTERN);
  if (!match) return { exists: false, valid: false, reason: 'path' };

  const novelId = match[1];
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const bucket = supabase.storage.from(RENDER_BUCKET);
  const { data: entries, error: listError } = await bucket.list(
    `renders/${novelId}`,
    { limit: 20, search: fileName }
  );
  if (listError) {
    throw new Error(
      `Thumbnail render verification failed: ${listError.message}`
    );
  }

  const entry = (entries ?? []).find((item) => item.name === fileName);
  if (!entry) return { exists: false, valid: false, reason: 'missing' };

  const { data: storedObject, error: downloadError } =
    await bucket.download(path);
  if (downloadError || !storedObject) {
    throw new Error(
      `Thumbnail render download verification failed: ${downloadError?.message || 'missing object'}`
    );
  }

  const metadataMime = normalizeMime(
    entry.metadata?.mimetype ?? entry.metadata?.contentType
  );
  const downloadedMime = normalizeMime(storedObject.type);
  const declaredMimes = [metadataMime, downloadedMime].filter(Boolean);
  const mimeValid =
    declaredMimes.length > 0 &&
    declaredMimes.every((mime) => mime === RENDER_CONTENT_TYPE);

  const bytes = new Uint8Array(await storedObject.arrayBuffer());
  const signatureValid = isWebpSignature(bytes);
  return {
    exists: true,
    valid: mimeValid && signatureValid,
    reason: !mimeValid ? 'mime' : signatureValid ? null : 'signature'
  };
}

async function removeRejectedRender(supabase, path) {
  try {
    const { error } = await supabase.storage.from(RENDER_BUCKET).remove([path]);
    if (error) console.error('Rejected thumbnail render cleanup failed', error);
  } catch (error) {
    console.error('Rejected thumbnail render cleanup failed', error);
  }
}

async function finalizeUpload({ supabase, user, body }) {
  const novelId = normalizeNovelId(body.novelId);
  const revision = normalizeRevision(body.revision);
  const path = String(body.path ?? '').trim();
  const match = path.match(PATH_PATTERN);
  if (!novelId || !revision || !match || match[1] !== novelId) {
    return {
      status: 400,
      payload: { error: 'Invalid thumbnail render metadata' }
    };
  }

  const composition = await loadOwnedComposition({
    supabase,
    userId: user.id,
    novelId,
    revision
  });
  if (!composition) {
    return {
      status: 409,
      payload: { error: 'Thumbnail composition changed' }
    };
  }

  const storedRender = await inspectStoredWebpObject(supabase, path);
  if (!storedRender.exists) {
    return {
      status: 409,
      payload: { error: 'Uploaded render was not found' }
    };
  }
  if (!storedRender.valid) {
    await removeRejectedRender(supabase, path);
    return {
      status: 415,
      payload: {
        error: 'Uploaded render must be a real image/webp WebP file',
        reason: storedRender.reason
      }
    };
  }

  const { data: publicData } = supabase.storage
    .from(RENDER_BUCKET)
    .getPublicUrl(path);
  const renderUrl = publicData?.publicUrl;
  if (!renderUrl || !renderUrl.startsWith('https://')) {
    throw new Error('Thumbnail render public URL could not be resolved');
  }

  const { data, error } = await supabase.rpc(
    'novelight_attach_thumbnail_render',
    {
      p_novel_id: novelId,
      p_revision: revision,
      p_storage_path: path,
      p_render_url: renderUrl
    }
  );
  if (error) {
    throw new Error(`Thumbnail render attach failed: ${error.message}`);
  }
  if (data !== true) {
    return {
      status: 409,
      payload: { error: 'Thumbnail composition changed' }
    };
  }

  return { status: 200, payload: { renderUrl } };
}

async function reportFailure({ supabase, user, req, body }) {
  const novelId = normalizeNovelId(body.novelId);
  const revision = normalizeRevision(body.revision);
  const requestedStage = boundedText(body.stage, 32);
  const stage = FAILURE_STAGES.has(requestedStage) ? requestedStage : 'unknown';
  const attempts = Math.max(
    1,
    Math.min(10, Number.parseInt(body.attempts, 10) || 1)
  );
  const errorCode = boundedText(body.errorCode, 120) || null;
  const errorMessage =
    boundedText(body.errorMessage, 800) || 'Unknown thumbnail render failure';
  const userAgent = boundedText(req.headers['user-agent'], 500) || null;

  if (!novelId || !revision) {
    return {
      status: 400,
      payload: { error: 'Invalid thumbnail failure report' }
    };
  }

  const composition = await loadOwnedComposition({
    supabase,
    userId: user.id,
    novelId,
    revision
  });
  if (!composition) {
    return {
      status: 409,
      payload: { error: 'Thumbnail composition changed' }
    };
  }

  const { error } = await supabase.from('thumbnail_render_failures').insert({
    novel_id: Number(novelId),
    user_id: user.id,
    revision,
    stage,
    error_code: errorCode,
    error_message: errorMessage,
    attempts,
    user_agent: userAgent
  });

  if (error) {
    // Keep the user-facing failure path reliable even during rolling deploys
    // where application code can briefly precede the database migration.
    console.error('Thumbnail failure report could not be persisted', {
      novelId,
      revision,
      stage,
      attempts,
      error: error.message
    });
    return { status: 202, payload: { recorded: false } };
  }

  return { status: 201, payload: { recorded: true } };
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
      } else if (action === 'report-failure') {
        result = await reportFailure({ supabase, user, req, body });
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
