// Phase 02-07-04: private server-side candidate review state machine.
// NOT mounted as an HTTP route. There is no provider connection or DB writer.
// Pending/accepted/rejected are review decisions, NOT author-confirmed canon.
// The future durable repository must implement transactional, scoped writes.
import { createHash } from 'node:crypto';

import { reviewNovelBibleInference } from './novel-bible-inference-review.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const KINDS = new Set([
  'character',
  'relationship',
  'location',
  'world',
  'timeline',
  'event',
  'foreshadowing',
  'other'
]);

function denied() {
  throw new Error('AI_OWNER_REVIEW_DENIED');
}

function positiveId(value) {
  const id =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(id) || id < 1) denied();
  return id;
}

function boundedText(value, length) {
  if (typeof value !== 'string' || !value.trim() || value.length > length) {
    denied();
  }
  return value.trim();
}

function requireAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.listAuthorConfirmed !== 'function' ||
    typeof adapter.savePendingBatch !== 'function' ||
    typeof adapter.readCandidate !== 'function' ||
    typeof adapter.compareAndSwapDecision !== 'function'
  ) {
    denied();
  }
}

function verifiedResponse(response) {
  if (response?.error || !response?.data) denied();
  return response.data;
}

// A token is checked with Supabase Auth on EVERY operation. Never trust
// caller-supplied user_id, metadata, route parameters or cached authorization.
export function createOwnerBibleReviewWorkflow({
  enabled = false,
  ownerId,
  authClient,
  serviceClient,
  repository
} = {}) {
  if (
    typeof ownerId !== 'string' ||
    !UUID.test(ownerId) ||
    typeof authClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function'
  ) {
    denied();
  }
  requireAdapter(repository);
  const owner = ownerId.toLowerCase();

  async function authenticate(token) {
    if (!enabled) throw new Error('AI_OWNER_REVIEW_DISABLED');
    if (
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/.test(token)
    ) {
      denied();
    }
    const result = await authClient.auth.getUser(token);
    const actorId = result?.data?.user?.id;
    if (
      result?.error ||
      typeof actorId !== 'string' ||
      !UUID.test(actorId) ||
      actorId.toLowerCase() !== owner
    ) {
      denied();
    }
    return actorId.toLowerCase();
  }

  async function loadNovel(actorId, novelId) {
    const workId = positiveId(novelId);
    const row = verifiedResponse(
      await serviceClient
        .from('novels')
        .select('id,user_id')
        .eq('id', workId)
        .maybeSingle()
    );
    if (
      positiveId(row.id) !== workId ||
      row.user_id?.toLowerCase() !== actorId
    ) {
      denied();
    }
    return { id: workId, user_id: actorId };
  }

  async function loadEpisode(novelId, episodeId) {
    const id = positiveId(episodeId);
    const row = verifiedResponse(
      await serviceClient
        .from('episodes')
        .select('id,novel_id,title,content')
        .eq('id', id)
        .maybeSingle()
    );
    if (positiveId(row.id) !== id || positiveId(row.novel_id) !== novelId) {
      denied();
    }
    return row;
  }

  async function confirmedFacts(actorId, novelId) {
    const facts = await repository.listAuthorConfirmed({ actorId, novelId });
    if (
      !Array.isArray(facts) ||
      facts.length > 500 ||
      facts.some((fact) => !KINDS.has(fact?.kind))
    ) {
      denied();
    }
    return facts.map((fact) => ({
      kind: fact.kind,
      key: boundedText(fact.key, 120)
    }));
  }

  // Internal server-only entrypoint: modelText is from a trusted, gated
  // model job, NEVER from a browser POST. The repository persists the entire
  // batch atomically or none of it (duplicate request => no additional rows).
  async function stage({ token, novelId, episodeId, sourceHash, modelText }) {
    const actorId = await authenticate(token);
    const novel = await loadNovel(actorId, novelId);
    const episode = await loadEpisode(novel.id, episodeId);
    const confirmed = await confirmedFacts(actorId, novel.id);
    const result = reviewNovelBibleInference({
      principal: { id: actorId },
      novel,
      episode,
      sourceHash,
      modelText,
      authorConfirmedFacts: confirmed
    });
    if (!result.candidates.length) {
      return { novelId: novel.id, stagedCount: 0 };
    }
    const identity = createHash('sha256')
      .update(JSON.stringify([actorId, novel.id, result.candidates]))
      .digest('hex');
    const saved = await repository.savePendingBatch({
      actorId,
      novelId: novel.id,
      episodeId: positiveId(episodeId),
      sourceHash,
      requestHash: identity,
      candidates: result.candidates
    });
    if (
      !saved ||
      !Number.isSafeInteger(saved.count) ||
      saved.count < 0 ||
      saved.count > result.candidates.length
    ) {
      denied();
    }
    return { novelId: novel.id, stagedCount: saved.count };
  }

  // The UI must require an explicit click. It supplies candidateId,
  // expectedRevision and action only. The authoritative row and chapter are
  // reloaded server-side; source/content changes invalidate stale approvals.
  async function decide({
    token,
    novelId,
    candidateId,
    expectedRevision,
    action,
    explicitAuthorAction
  }) {
    if (
      explicitAuthorAction !== true ||
      !['accept', 'reject'].includes(action) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      denied();
    }
    const actorId = await authenticate(token);
    const novel = await loadNovel(actorId, novelId);
    const factId = positiveId(candidateId);
    const row = await repository.readCandidate({
      actorId,
      novelId: novel.id,
      candidateId: factId
    });
    if (
      !row ||
      positiveId(row.id) !== factId ||
      positiveId(row.novelId) !== novel.id ||
      row.actorId !== actorId ||
      row.status !== 'pending' ||
      row.provenance !== 'ai_inferred' ||
      row.revision !== expectedRevision ||
      typeof row.sourceHash !== 'string' ||
      !SHA256.test(row.sourceHash)
    ) {
      denied();
    }
    const episode = await loadEpisode(novel.id, row.sourceEpisodeId);
    const confirmed = await confirmedFacts(actorId, novel.id);
    reviewNovelBibleInference({
      principal: { id: actorId },
      novel,
      episode,
      sourceHash: row.sourceHash,
      modelText: JSON.stringify({
        suggestions: [
          {
            kind: row.factKind,
            key: row.factKey,
            summary: row.summary,
            evidence: row.evidence
          }
        ]
      }),
      authorConfirmedFacts: confirmed
    });
    const updated = await repository.compareAndSwapDecision({
      actorId,
      novelId: novel.id,
      candidateId: factId,
      sourceHash: row.sourceHash,
      expectedRevision,
      expectedStatus: 'pending',
      decision: action === 'accept' ? 'accepted' : 'rejected'
    });
    if (
      !updated ||
      updated.status !== (action === 'accept' ? 'accepted' : 'rejected') ||
      updated.revision !== expectedRevision + 1
    ) {
      denied();
    }
    // Accepted means "author has reviewed this proposal", not an automatic
    // write to the canonical character directory or private creative notes.
    return {
      candidateId: factId,
      novelId: novel.id,
      status: updated.status,
      revision: updated.revision,
      canonModified: false
    };
  }

  // Candidate listing is still private author data. No inference or write.
  async function list({ token, novelId }) {
    const actorId = await authenticate(token);
    const novel = await loadNovel(actorId, novelId);
    if (typeof repository.listPending !== 'function') denied();
    const rows = await repository.listPending({
      actorId,
      novelId: novel.id
    });
    if (!Array.isArray(rows) || rows.length > 100) denied();
    const candidates = rows.map((row) => {
      if (
        !row ||
        row.actorId !== actorId ||
        positiveId(row.novelId) !== novel.id ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1 ||
        row.status !== 'pending' ||
        row.provenance !== 'ai_inferred' ||
        !KINDS.has(row.factKind) ||
        typeof row.sourceHash !== 'string' ||
        !SHA256.test(row.sourceHash)
      ) {
        denied();
      }
      return {
        id: positiveId(row.id),
        revision: row.revision,
        episodeId: positiveId(row.sourceEpisodeId),
        kind: row.factKind,
        key: boundedText(row.factKey, 120),
        summary: boundedText(row.summary, 320),
        evidence: boundedText(row.evidence, 160),
        status: 'pending'
      };
    });
    return { novelId: novel.id, candidates, aiGenerated: false };
  }

  return Object.freeze({ stage, decide, list });
}
