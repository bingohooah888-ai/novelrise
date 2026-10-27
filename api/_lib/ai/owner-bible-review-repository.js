// Service-only persistence adapter. Requires a separately approved SQL
// migration; importing this file does not migrate or modify the database.
// All methods are called only after server-side Auth + work ownership checks.
import { createSupabaseAiBible } from './supabase-store.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function unavailable() {
  throw new Error('AI_REVIEW_STORAGE_UNAVAILABLE');
}

function validId(id) {
  return Number.isSafeInteger(Number(id)) && Number(id) > 0;
}

function requireScope(actorId, novelId) {
  if (typeof actorId !== 'string' || !UUID.test(actorId) || !validId(novelId)) {
    unavailable();
  }
}

function mapRow(row) {
  if (
    !row ||
    !validId(row.id) ||
    !validId(row.novel_id) ||
    !validId(row.source_episode_id) ||
    typeof row.actor_id !== 'string' ||
    !UUID.test(row.actor_id) ||
    typeof row.source_hash !== 'string' ||
    !SHA256.test(row.source_hash)
  ) {
    unavailable();
  }
  return {
    id: Number(row.id),
    actorId: row.actor_id,
    novelId: Number(row.novel_id),
    sourceEpisodeId: Number(row.source_episode_id),
    sourceHash: row.source_hash,
    factKind: row.fact_kind,
    factKey: row.fact_key,
    summary: row.summary,
    evidence: row.evidence,
    provenance: 'ai_inferred',
    status: row.status,
    revision: row.revision
  };
}

export function createSupabaseOwnerBibleReviewRepository({
  serviceClient,
  authorClient
} = {}) {
  if (
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    !authorClient ||
    authorClient === serviceClient ||
    typeof authorClient.rpc !== 'function'
  ) {
    unavailable();
  }
  const bible = createSupabaseAiBible({ serviceClient, authorClient });

  return Object.freeze({
    async listAuthorConfirmed({ actorId, novelId }) {
      requireScope(actorId, novelId);
      const canon = await bible.listOwnerCanon({ actorId, novelId });
      const { data, error } = await serviceClient
        .from('novelight_ai_bible_facts')
        .select('fact_kind,fact_key')
        .eq('novel_id', novelId)
        .eq('provenance', 'author_confirmed')
        .limit(400);
      if (error || !Array.isArray(data)) unavailable();
      return [
        ...canon.characters.map((character) => ({
          kind: 'character',
          key: character.name
        })),
        ...data.map((fact) => ({
          kind: fact.fact_kind,
          key: fact.fact_key
        }))
      ];
    },

    async listPending({ actorId, novelId }) {
      requireScope(actorId, novelId);
      const { data, error } = await serviceClient
        .from('novelight_ai_review_candidates')
        .select(
          'id,actor_id,novel_id,source_episode_id,source_hash,' +
            'fact_kind,fact_key,summary,evidence,status,revision'
        )
        .eq('actor_id', actorId)
        .eq('novel_id', novelId)
        .eq('status', 'pending')
        .order('id', { ascending: true })
        .limit(100);
      if (error || !Array.isArray(data)) unavailable();
      return data.map(mapRow);
    },

    async readCandidate({ actorId, novelId, candidateId }) {
      requireScope(actorId, novelId);
      if (!validId(candidateId)) unavailable();
      const { data, error } = await serviceClient
        .from('novelight_ai_review_candidates')
        .select(
          'id,actor_id,novel_id,source_episode_id,source_hash,' +
            'fact_kind,fact_key,summary,evidence,status,revision'
        )
        .eq('actor_id', actorId)
        .eq('novel_id', novelId)
        .eq('id', candidateId)
        .maybeSingle();
      if (error) unavailable();
      return data ? mapRow(data) : null;
    },

    // SQL RPC must validate ownership and persist all-or-nothing with UNIQUE
    // idempotency and its own source episode/work foreign-key check.
    async savePendingBatch({
      actorId,
      novelId,
      episodeId,
      sourceHash,
      requestHash,
      candidates
    }) {
      requireScope(actorId, novelId);
      if (
        !validId(episodeId) ||
        !SHA256.test(sourceHash) ||
        !SHA256.test(requestHash) ||
        !Array.isArray(candidates) ||
        candidates.length < 1 ||
        candidates.length > 12
      ) {
        unavailable();
      }
      const safe = candidates.map((candidate) => ({
        kind: candidate.factKind,
        key: candidate.factKey,
        summary: candidate.factPayload?.summary,
        evidence: candidate.factPayload?.evidence
      }));
      const { data, error } = await serviceClient.rpc(
        'novelight_ai_review_stage_batch',
        {
          p_actor_id: actorId,
          p_novel_id: novelId,
          p_episode_id: episodeId,
          p_source_hash: sourceHash,
          p_request_hash: requestHash,
          p_candidates: safe
        }
      );
      if (error || !Number.isSafeInteger(data) || data < 0) unavailable();
      return { count: data };
    },

    async compareAndSwapDecision({
      actorId,
      novelId,
      candidateId,
      sourceHash,
      expectedRevision,
      expectedStatus,
      decision
    }) {
      requireScope(actorId, novelId);
      if (
        !validId(candidateId) ||
        !SHA256.test(sourceHash) ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 1 ||
        expectedStatus !== 'pending' ||
        !['accepted', 'rejected'].includes(decision)
      ) {
        unavailable();
      }
      const { data, error } = await serviceClient.rpc(
        'novelight_ai_review_decide',
        {
          p_actor_id: actorId,
          p_novel_id: novelId,
          p_candidate_id: candidateId,
          p_source_hash: sourceHash,
          p_expected_revision: expectedRevision,
          p_decision: decision
        }
      );
      if (error) unavailable();
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || result.status !== decision) return null;
      if (result.revision !== expectedRevision + 1) unavailable();
      return { status: result.status, revision: result.revision };
    }
  });
}
