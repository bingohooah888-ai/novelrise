const RENDER_BUCKET = 'novel-thumbnail-renders';
const PATH_PATTERN = /^renders\/([0-9]+)\/[0-9a-f-]{36}\.(webp|png)$/i;
const REVISION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getBearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function normalizeNovelId(value) {
  const text = String(value ?? '').trim();
  return /^[0-9]+$/.test(text) ? text : null;
}

function normalizeRevision(value) {
  const text = String(value ?? '').trim();
  return REVISION_PATTERN.test(text) ? text : null;
}

function failedStatus(statusCode) {
  const status = Number(statusCode);
  return Number.isInteger(status) && status >= 400;
}

export async function cleanupFailedThumbnailFinalize({
  supabase,
  body,
  statusCode,
  authorization
}) {
  if (
    !failedStatus(statusCode) ||
    String(body?.action ?? '') !== 'finalize-upload'
  ) {
    return false;
  }

  const novelId = normalizeNovelId(body?.novelId);
  const revision = normalizeRevision(body?.revision);
  const path = String(body?.path ?? '').trim();
  const match = path.match(PATH_PATTERN);
  const token = getBearerToken(authorization);
  if (!novelId || !revision || !match || match[1] !== novelId || !token) {
    return false;
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(
      token
    );
    const userId = authData?.user?.id;
    if (authError || !userId) return false;

    const { data: novel, error: novelError } = await supabase
      .from('novels')
      .select('id')
      .eq('id', Number(novelId))
      .eq('user_id', userId)
      .maybeSingle();

    if (novelError || !novel) return false;

    const { data: composition, error: compositionError } = await supabase
      .from('novel_thumbnail_compositions')
      .select('render_storage_path')
      .eq('novel_id', Number(novelId))
      .maybeSingle();

    if (compositionError) {
      console.error(
        'Failed thumbnail finalize cleanup could not verify adoption',
        {
          novelId,
          path,
          error: compositionError.message
        }
      );
      return false;
    }

    if (composition?.render_storage_path === path) return false;

    const { error: removeError } = await supabase.storage
      .from(RENDER_BUCKET)
      .remove([path]);
    if (removeError) {
      console.error(
        'Failed thumbnail finalize cleanup could not remove render',
        {
          novelId,
          path,
          error: removeError.message
        }
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed thumbnail finalize cleanup failed safely', {
      novelId,
      path,
      error: error?.message || String(error)
    });
    return false;
  }
}
