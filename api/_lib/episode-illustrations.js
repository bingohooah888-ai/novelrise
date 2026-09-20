import { randomUUID } from 'node:crypto';

const BUCKET = 'episode-illustrations';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_DELIVERY_EDGE = 2000;
const SIGNED_URL_SECONDS = 10 * 60;
const PATH_PATTERN =
  /^([0-9a-f-]{36})\/([0-9]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/iu;
const MARKER_PATTERN =
  /^[\t ]*\[\[NOVELIGHT_ILLUSTRATION:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\][\t ]*$/gimu;

function bearerToken(value) {
  const match =
    typeof value === 'string' ? value.match(/^Bearer\s+(\S+)$/iu) : null;
  return match?.[1] ?? null;
}

function bodyObject(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function positiveId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/u.test(text) && Number(text) > 0 ? text : null;
}

function uuid(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    text
  )
    ? text
    : null;
}

function altText(value) {
  const text = String(value ?? '').replace(/\r\n?/gu, '\n');
  return text.length <= 500 ? text : null;
}

async function currentUser(req, supabase) {
  const token = bearerToken(req.headers.authorization);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

async function editorBundle(supabase, episodeId, userId) {
  const { data, error } = await supabase.rpc(
    'novelight_episode_illustration_editor_bundle',
    {
      p_episode_id: episodeId,
      p_actor_user_id: userId
    }
  );
  if (error)
    throw new Error(`Illustration access lookup failed: ${error.message}`);
  return data;
}

function webpDimensions(bytes) {
  if (
    bytes.length < 16 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('INVALID_WEBP');
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) throw new Error('INVALID_WEBP');

    if (type === 'VP8X' && size >= 10) {
      return {
        width: bytes.readUIntLE(data + 4, 3) + 1,
        height: bytes.readUIntLE(data + 7, 3) + 1
      };
    }
    if (type === 'VP8 ' && size >= 10) {
      if (bytes.subarray(data + 3, data + 6).toString('hex') !== '9d012a') {
        throw new Error('INVALID_WEBP');
      }
      return {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff
      };
    }
    if (type === 'VP8L' && size >= 5) {
      if (bytes[data] !== 0x2f) throw new Error('INVALID_WEBP');
      const dimensions = bytes.readUInt32LE(data + 1);
      return {
        width: (dimensions & 0x3fff) + 1,
        height: ((dimensions >>> 14) & 0x3fff) + 1
      };
    }

    offset = data + size + (size % 2);
  }
  throw new Error('INVALID_WEBP');
}

async function signedAsset(supabase, asset) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(asset.storage_path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error('Illustration signed URL could not be created');
  }
  return {
    id: asset.id,
    url: data.signedUrl,
    width: Number(asset.width),
    height: Number(asset.height),
    altText: String(asset.alt_text ?? ''),
    marker: `[[NOVELIGHT_ILLUSTRATION:${asset.id}]]`
  };
}
async function prepareUpload({ supabase, user, body }) {
  const episodeId = positiveId(body.episodeId);
  const fileSize = Number(body.fileSize);
  if (
    !episodeId ||
    !Number.isInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > MAX_FILE_SIZE
  ) {
    return {
      status: 400,
      payload: { error: 'Invalid illustration upload request' }
    };
  }

  const bundle = await editorBundle(supabase, episodeId, user.id);
  if (!bundle?.can_edit) {
    return {
      status: 403,
      payload: { error: 'Illustration edit access required' }
    };
  }
  if (typeof bundle.illustration_ai_usage !== 'boolean') {
    return {
      status: 409,
      payload: { error: 'ILLUSTRATION_AI_USAGE_REQUIRED' }
    };
  }
  if (Number(bundle.assets?.length ?? 0) >= Number(bundle.limit ?? 10)) {
    return {
      status: 409,
      payload: { error: 'EPISODE_ILLUSTRATION_LIMIT_REACHED' }
    };
  }

  const { error: authorizeError } = await supabase.rpc(
    'novelight_authorize_episode_illustration_upload',
    {
      p_episode_id: episodeId,
      p_actor_user_id: user.id
    }
  );
  if (authorizeError) {
    const message = String(authorizeError.message ?? '');
    if (message.includes('EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED')) {
      return {
        status: 429,
        payload: { error: 'EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED' }
      };
    }
    if (authorizeError.code === '42501') {
      return {
        status: 403,
        payload: { error: 'Illustration edit access required' }
      };
    }
    throw authorizeError;
  }

  const path = `${bundle.owner_user_id}/${episodeId}/${randomUUID()}.webp`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error('Illustration signed upload creation failed', error);
    return {
      status: 503,
      payload: { error: 'Illustration upload could not be prepared' }
    };
  }

  return {
    status: 200,
    payload: {
      path,
      token: data.token,
      bucket: BUCKET,
      maxFileSize: MAX_FILE_SIZE,
      maxDeliveryEdge: MAX_DELIVERY_EDGE
    }
  };
}

async function removeUnregisteredObject(supabase, path) {
  if (!PATH_PATTERN.test(path)) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error('Illustration orphan upload cleanup failed', error);
}

async function finalizeUpload({ supabase, user, body }) {
  const episodeId = positiveId(body.episodeId);
  const path = String(body.path ?? '').trim();
  const alt = altText(body.altText);
  const match = path.match(PATH_PATTERN);
  if (!episodeId || !match || match[2] !== episodeId || alt === null) {
    return { status: 400, payload: { error: 'Invalid illustration metadata' } };
  }

  const bundle = await editorBundle(supabase, episodeId, user.id);
  if (
    !bundle?.can_edit ||
    String(bundle.owner_user_id).toLowerCase() !== match[1].toLowerCase()
  ) {
    return {
      status: 403,
      payload: { error: 'Illustration edit access required' }
    };
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error('ILLUSTRATION_UPLOAD_NOT_FOUND');
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_FILE_SIZE) {
      throw new Error('ILLUSTRATION_FILE_SIZE_INVALID');
    }
    const dimensions = webpDimensions(bytes);
    if (
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > MAX_DELIVERY_EDGE ||
      dimensions.height > MAX_DELIVERY_EDGE
    ) {
      throw new Error('ILLUSTRATION_DIMENSIONS_INVALID');
    }

    const { data: illustrationId, error: registerError } = await supabase.rpc(
      'novelight_register_episode_illustration',
      {
        p_episode_id: episodeId,
        p_actor_user_id: user.id,
        p_storage_path: path,
        p_mime_type: 'image/webp',
        p_file_size: bytes.length,
        p_width: dimensions.width,
        p_height: dimensions.height,
        p_alt_text: alt
      }
    );
    if (registerError) throw registerError;
    const id = uuid(illustrationId);
    if (!id) throw new Error('ILLUSTRATION_REGISTRATION_INVALID');

    return {
      status: 200,
      payload: {
        id,
        width: dimensions.width,
        height: dimensions.height,
        altText: alt,
        marker: `[[NOVELIGHT_ILLUSTRATION:${id}]]`
      }
    };
  } catch (error) {
    await removeUnregisteredObject(supabase, path);
    console.error('Illustration finalization failed', error);
    const message = String(error?.message ?? '');
    if (message.includes('EPISODE_ILLUSTRATION_LIMIT_REACHED')) {
      return {
        status: 409,
        payload: { error: 'EPISODE_ILLUSTRATION_LIMIT_REACHED' }
      };
    }
    if (message.includes('ILLUSTRATION_AI_USAGE_REQUIRED')) {
      return {
        status: 409,
        payload: { error: 'ILLUSTRATION_AI_USAGE_REQUIRED' }
      };
    }
    return {
      status: 400,
      payload: { error: 'Uploaded illustration is invalid' }
    };
  }
}
async function editorList({ supabase, user, body }) {
  const episodeId = positiveId(body.episodeId);
  if (!episodeId) return { status: 400, payload: { error: 'Invalid episode' } };
  const bundle = await editorBundle(supabase, episodeId, user.id);
  if (!bundle?.can_edit) {
    return {
      status: 403,
      payload: { error: 'Illustration edit access required' }
    };
  }
  const assets = await Promise.all(
    (bundle.assets ?? []).map((asset) => signedAsset(supabase, asset))
  );
  return {
    status: 200,
    payload: {
      episodeId: Number(episodeId),
      novelId: Number(bundle.novel_id),
      isOwner: bundle.is_owner === true,
      aiUsage:
        typeof bundle.illustration_ai_usage === 'boolean'
          ? bundle.illustration_ai_usage
          : null,
      limit: Number(bundle.limit ?? 10),
      assets
    }
  };
}

async function setAiUsage({ supabase, user, body }) {
  const novelId = positiveId(body.novelId);
  if (!novelId || typeof body.value !== 'boolean') {
    return {
      status: 400,
      payload: { error: 'Invalid illustration AI declaration' }
    };
  }
  const { data, error } = await supabase.rpc(
    'novelight_set_illustration_ai_usage',
    {
      p_novel_id: novelId,
      p_actor_user_id: user.id,
      p_value: body.value
    }
  );
  if (error) {
    if (error.code === '42501') {
      return { status: 403, payload: { error: 'Owner access required' } };
    }
    throw error;
  }
  return { status: 200, payload: { saved: data === true, value: body.value } };
}

async function updateAlt({ supabase, user, body }) {
  const illustrationId = uuid(body.illustrationId);
  const alt = altText(body.altText);
  if (!illustrationId || alt === null) {
    return { status: 400, payload: { error: 'Invalid illustration alt text' } };
  }
  const { data, error } = await supabase.rpc(
    'novelight_update_episode_illustration_alt',
    {
      p_illustration_id: illustrationId,
      p_actor_user_id: user.id,
      p_alt_text: alt
    }
  );
  if (error) {
    if (error.code === '42501') {
      return {
        status: 403,
        payload: { error: 'Illustration edit access required' }
      };
    }
    throw error;
  }
  return { status: 200, payload: { saved: data === true, altText: alt } };
}

function referencedIds(content) {
  const ids = new Set();
  const source = String(content ?? '');
  MARKER_PATTERN.lastIndex = 0;
  let match;
  while ((match = MARKER_PATTERN.exec(source))) ids.add(match[1].toLowerCase());
  return ids;
}

async function readerList({ supabase, body }) {
  const episodeId = positiveId(body.episodeId);
  if (!episodeId) return { status: 400, payload: { error: 'Invalid episode' } };

  const { data: bundle, error } = await supabase.rpc(
    'novelight_public_episode_illustration_bundle',
    { p_episode_id: episodeId }
  );
  if (error) throw error;
  if (!bundle)
    return { status: 404, payload: { error: 'Episode unavailable' } };

  const ids = referencedIds(bundle.content);
  const selected = (bundle.assets ?? []).filter((asset) =>
    ids.has(String(asset.id).toLowerCase())
  );
  const assets = await Promise.all(
    selected.map((asset) => signedAsset(supabase, asset))
  );

  return {
    status: 200,
    payload: {
      episodeId: Number(episodeId),
      aiUsage: bundle.illustration_ai_usage === true,
      assets
    }
  };
}

async function exportBundle({ supabase, user, body }) {
  const novelId = positiveId(body.novelId);
  if (!novelId) return { status: 400, payload: { error: 'Invalid novel' } };

  const { data: bundle, error } = await supabase.rpc(
    'novelight_owner_illustration_export_bundle',
    {
      p_novel_id: novelId,
      p_actor_user_id: user.id
    }
  );
  if (error) {
    if (error.code === '42501') {
      return { status: 403, payload: { error: 'Owner access required' } };
    }
    throw error;
  }

  const assets = await Promise.all(
    (bundle?.assets ?? []).map(async (asset) => ({
      ...(await signedAsset(supabase, asset)),
      episodeId: Number(asset.episode_id),
      mimeType: String(asset.mime_type ?? 'image/webp'),
      fileSize: Number(asset.file_size ?? 0),
      createdAt: asset.created_at ?? null
    }))
  );

  return {
    status: 200,
    payload: {
      novelId: Number(novelId),
      aiUsage:
        typeof bundle?.illustration_ai_usage === 'boolean'
          ? bundle.illustration_ai_usage
          : null,
      assets
    }
  };
}
export function createEpisodeIllustrationsHandler({ supabase }) {
  return async function episodeIllustrationsHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = bodyObject(req);
    const action = String(body.action ?? '');
    const requiresUser = action !== 'reader-list';
    const user = requiresUser ? await currentUser(req, supabase) : null;
    if (requiresUser && !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      let result;
      if (action === 'prepare-upload') {
        result = await prepareUpload({ supabase, user, body });
      } else if (action === 'finalize-upload') {
        result = await finalizeUpload({ supabase, user, body });
      } else if (action === 'editor-list') {
        result = await editorList({ supabase, user, body });
      } else if (action === 'set-ai-usage') {
        result = await setAiUsage({ supabase, user, body });
      } else if (action === 'update-alt') {
        result = await updateAlt({ supabase, user, body });
      } else if (action === 'reader-list') {
        result = await readerList({ supabase, body });
      } else if (action === 'export-bundle') {
        result = await exportBundle({ supabase, user, body });
      } else {
        result = { status: 400, payload: { error: 'Invalid action' } };
      }
      res.status(result.status).json(result.payload);
    } catch (error) {
      console.error('Episode illustration API failed', error);
      res
        .status(503)
        .json({ error: 'Episode illustration service unavailable' });
    }
  };
}

export const episodeIllustrationInternals = Object.freeze({
  BUCKET,
  MAX_FILE_SIZE,
  MAX_DELIVERY_EDGE,
  SIGNED_URL_SECONDS,
  PATH_PATTERN,
  MARKER_PATTERN,
  webpDimensions,
  referencedIds
});
