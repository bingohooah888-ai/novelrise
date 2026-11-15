// Phase 02-07-05: unmounted, server-only analysis checkpoint -> revision reader.
// Reuses the existing episode_analysis table and bounded private revision
// history. No schema, credentials, HTTP endpoint, writes or model calls.
// Call ONLY after owner/session verification in the guarded trial bridge.
import { createHash } from 'node:crypto';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function unavailable() {
  throw new Error('AI_BIBLE_HISTORY_UNAVAILABLE');
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function digest(title, content) {
  return createHash('sha256')
    .update(JSON.stringify([title, content]))
    .digest('hex');
}

function validSource(row) {
  return (
    typeof row?.title === 'string' &&
    typeof row?.content === 'string' &&
    Buffer.byteLength(row.title, 'utf8') <= 8192 &&
    Buffer.byteLength(row.content, 'utf8') <= 1000000
  );
}

// Historical revisions are snapshots of the OLD text, not a model prompt.
// No browser-supplied snapshots, client ownership assertions or candidate
// rows can act as a completed-analysis checkpoint.
export function createOwnerNovelBibleVerifiedHistoryReader({
  serviceClient,
  nowEpochSeconds = () => Math.floor(Date.now() / 1000)
} = {}) {
  if (
    typeof serviceClient?.from !== 'function' ||
    typeof nowEpochSeconds !== 'function'
  ) {
    unavailable();
  }

  return async function readVerifiedHistory({
    actorId,
    novelId,
    episodeId
  } = {}) {
    if (
      typeof actorId !== 'string' ||
      !UUID.test(actorId) ||
      !positive(novelId) ||
      !positive(episodeId)
    ) {
      unavailable();
    }
    const owner = actorId.toLowerCase();
    const novelResult = await serviceClient
      .from('novels')
      .select('id,user_id')
      .eq('id', novelId)
      .maybeSingle();
    if (
      novelResult?.error ||
      Number(novelResult?.data?.id) !== novelId ||
      novelResult?.data?.user_id?.toLowerCase() !== owner
    ) {
      unavailable();
    }
    const episodeResult = await serviceClient
      .from('episodes')
      .select('id,novel_id,user_id,title,content')
      .eq('id', episodeId)
      .maybeSingle();
    const current = episodeResult?.data;
    if (
      episodeResult?.error ||
      Number(current?.id) !== episodeId ||
      Number(current?.novel_id) !== novelId ||
      current?.user_id?.toLowerCase() !== owner ||
      !validSource(current)
    ) {
      unavailable();
    }
    const analysisResult = await serviceClient
      .from('novelight_ai_episode_analysis')
      .select('episode_id,source_hash,revision')
      .eq('episode_id', episodeId)
      .maybeSingle();
    if (analysisResult?.error) unavailable();
    const analysis = analysisResult?.data;
    if (analysis === null) return null;
    if (
      Number(analysis?.episode_id) !== episodeId ||
      typeof analysis?.source_hash !== 'string' ||
      !HASH.test(analysis.source_hash) ||
      !positive(analysis.revision)
    ) {
      unavailable();
    }
    const acknowledged = {
      episode_id: episodeId,
      source_hash: analysis.source_hash
    };
    // An unchanged, fully acknowledged episode has no excerpt to process.
    if (digest(current.title, current.content) === analysis.source_hash) {
      return { analysis: acknowledged };
    }

    // A retained edit/restore revision is used only when its OWN text hashes
    // to the authoritative completed-analysis checkpoint. If history is
    // expired or missing, the existing planner safely falls back to the
    // full CURRENT episode, never a guessed differential.
    const revisionResult = await serviceClient
      .from('episode_revisions')
      .select('id,episode_id,novel_id,user_id,title,content,created_at')
      .eq('episode_id', episodeId)
      .eq('novel_id', novelId)
      .eq('user_id', owner)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(20);
    if (revisionResult?.error || !Array.isArray(revisionResult?.data)) {
      unavailable();
    }
    const now = nowEpochSeconds() * 1000;
    if (!Number.isFinite(now) || now <= 0) unavailable();
    for (const row of revisionResult.data) {
      if (
        Number(row?.episode_id) !== episodeId ||
        Number(row?.novel_id) !== novelId ||
        row?.user_id?.toLowerCase() !== owner ||
        !validSource(row)
      ) {
        unavailable();
      }
      const modified = Date.parse(row.created_at);
      if (!Number.isFinite(modified)) unavailable();
      if (modified < now - RETENTION_MS || modified > now + 60000) {
        continue;
      }
      if (digest(row.title, row.content) === analysis.source_hash) {
        return {
          analysis: acknowledged,
          episode: {
            id: episodeId,
            novel_id: novelId,
            title: row.title,
            content: row.content
          }
        };
      }
    }
    return { analysis: acknowledged };
  };
}
