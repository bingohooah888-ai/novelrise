import { createClient } from '@supabase/supabase-js';

const BUCKET = 'episode-illustrations';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function bearerToken(value) {
  const match =
    typeof value === 'string' ? value.match(/^Bearer\s+(\S+)$/iu) : null;
  return match?.[1] ?? null;
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

function markerUsed(content, illustrationId) {
  const marker = `[[NOVELIGHT_ILLUSTRATION:${illustrationId}]]`;
  return String(content ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .some((line) => line.trim().toLowerCase() === marker.toLowerCase());
}

export default async function episodeIllustrationDelete(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = bearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { data: authData, error: authError } =
    await supabase.auth.getUser(token);
  const user = authError ? null : authData?.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const episodeId = positiveId(body.episodeId);
  const illustrationId = uuid(body.illustrationId);
  if (!episodeId || !illustrationId) {
    res.status(400).json({ error: 'Invalid illustration delete request' });
    return;
  }

  try {
    const { data: bundle, error: bundleError } = await supabase.rpc(
      'novelight_episode_illustration_editor_bundle',
      {
        p_episode_id: episodeId,
        p_actor_user_id: user.id
      }
    );
    if (bundleError) throw bundleError;
    if (!bundle?.can_edit) {
      res.status(403).json({ error: 'Illustration edit access required' });
      return;
    }

    const asset = (bundle.assets ?? []).find(
      (item) => String(item?.id ?? '').toLowerCase() === illustrationId
    );
    if (!asset) {
      res.status(404).json({ error: 'Illustration not found' });
      return;
    }

    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select('content')
      .eq('id', episodeId)
      .maybeSingle();
    if (episodeError) throw episodeError;
    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    if (markerUsed(episode.content, illustrationId)) {
      res.status(409).json({
        error: 'EPISODE_ILLUSTRATION_IN_USE',
        message:
          '本文で使用中の挿絵は削除できません。本文から外して保存してから削除してください。'
      });
      return;
    }

    const { data: deleted, error: deleteError } = await supabase
      .from('episode_illustrations')
      .delete()
      .eq('id', illustrationId)
      .eq('episode_id', episodeId)
      .select('id')
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) {
      res.status(404).json({ error: 'Illustration not found' });
      return;
    }

    let storageCleanupPending = false;
    const storagePath = String(asset.storage_path ?? '').trim();
    if (storagePath) {
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);
      if (storageError) {
        storageCleanupPending = true;
        console.error('Deleted illustration storage cleanup failed', {
          illustrationId,
          episodeId,
          message: String(storageError.message ?? storageError)
        });
      }
    }

    res.status(200).json({
      deleted: true,
      illustrationId,
      storageCleanupPending
    });
  } catch (error) {
    console.error('Episode illustration delete failed', error);
    res.status(503).json({ error: 'Episode illustration delete unavailable' });
  }
}
