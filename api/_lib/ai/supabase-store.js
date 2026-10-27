// Service-role Supabase adapter for the Phase 2 foundation.
// Never instantiate this module with a browser client or pass it to the UI.
import { requireAiFeature } from './registry.js';

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

export class AiStorageError extends Error {
  constructor() {
    super('AI_STORAGE_UNAVAILABLE');
    this.name = 'AiStorageError';
  }
}

function requireServiceClient(serviceClient) {
  if (
    !serviceClient ||
    typeof serviceClient.rpc !== 'function' ||
    typeof serviceClient.from !== 'function'
  ) {
    throw new AiStorageError();
  }
}

function requireIdentity(actorId) {
  if (typeof actorId !== 'string' || !UUID.test(actorId)) {
    throw new Error('AI_INVALID_IDENTITY');
  }
}

function requireWorkId(workId) {
  if (!Number.isSafeInteger(Number(workId)) || Number(workId) <= 0) {
    throw new Error('AI_INVALID_WORK');
  }
}

export function createSupabaseAiBudget({ serviceClient }) {
  requireServiceClient(serviceClient);
  return Object.freeze({
    async reserve({ actorId, featureKey, workId, ceilingMicros, requestHash }) {
      requireIdentity(actorId);
      requireAiFeature(featureKey);
      if (workId !== null && workId !== undefined) requireWorkId(workId);
      if (
        !Number.isSafeInteger(ceilingMicros) ||
        ceilingMicros <= 0 ||
        typeof requestHash !== 'string' ||
        !SHA256.test(requestHash)
      ) {
        throw new Error('AI_INVALID_BUDGET_REQUEST');
      }
      const { data, error } = await serviceClient.rpc(
        'novelight_ai_reserve_usage',
        {
          p_actor_id: actorId,
          p_feature_key: featureKey,
          p_work_id: workId ?? null,
          p_ceiling_micros: ceilingMicros,
          p_request_hash: requestHash
        }
      );
      if (error) throw new AiStorageError();
      // Null means global kill switch, exhausted budget, or duplicate request.
      return typeof data === 'string' && UUID.test(data) ? { id: data } : null;
    },
    async settle({ reservationId, chargedMicros }) {
      if (
        typeof reservationId !== 'string' ||
        !UUID.test(reservationId) ||
        !Number.isSafeInteger(chargedMicros) ||
        chargedMicros < 0
      ) {
        throw new Error('AI_INVALID_SETTLEMENT');
      }
      const { data, error } = await serviceClient.rpc(
        'novelight_ai_settle_usage',
        {
          p_reservation_id: reservationId,
          p_charged_micros: chargedMicros
        }
      );
      if (error || data !== true) throw new AiStorageError();
    }
  });
}

export function createSupabaseAiAudit({ serviceClient }) {
  requireServiceClient(serviceClient);
  return Object.freeze({
    async record(event) {
      const feature = requireAiFeature(event.featureKey);
      requireIdentity(event.actorId);
      if (event.workId !== null && event.workId !== undefined) {
        requireWorkId(event.workId);
      }
      const micros = event.chargedMicros ?? 0;
      if (!Number.isSafeInteger(micros) || micros < 0) {
        throw new Error('AI_INVALID_AUDIT');
      }
      // Strict field allowlist: never persist prompts, content, IPs or AI output.
      const { error } = await serviceClient
        .from('novelight_ai_usage_audit')
        .insert({
          actor_id: event.actorId,
          feature_key: feature.key,
          work_id: event.workId ?? null,
          provider: String(event.provider ?? '').slice(0, 80) || null,
          model: String(event.model ?? '').slice(0, 120) || null,
          charged_micros: micros,
          cache_hit: event.cacheHit === true,
          outcome: event.cacheHit
            ? 'cache_hit'
            : event.outcome === 'success'
              ? 'success'
              : 'failed'
        });
      if (error) throw new AiStorageError();
    }
  });
}

export function createSupabaseAiBible({ serviceClient }) {
  requireServiceClient(serviceClient);
  async function assertOwner(actorId, novelId) {
    requireIdentity(actorId);
    requireWorkId(novelId);
    const { data, error } = await serviceClient
      .from('novels')
      .select('id,user_id')
      .eq('id', novelId)
      .maybeSingle();
    if (error) throw new AiStorageError();
    if (!data || data.user_id !== actorId) throw new Error('AI_ACCESS_DENIED');
  }

  return Object.freeze({
    async listOwnerFacts({ actorId, novelId }) {
      await assertOwner(actorId, novelId);
      const { data, error } = await serviceClient
        .from('novelight_ai_bible_facts')
        .select(
          'id,novel_id,source_episode_id,fact_kind,fact_key,fact_payload,provenance,revision,updated_at'
        )
        .eq('novel_id', novelId)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw new AiStorageError();
      return data || [];
    },
    async saveAiInference({
      actorId,
      novelId,
      episodeId = null,
      kind,
      key,
      payload,
      sourceHash
    }) {
      await assertOwner(actorId, novelId);
      if (
        !KINDS.has(kind) ||
        typeof key !== 'string' ||
        key.length < 1 ||
        key.length > 120 ||
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        typeof sourceHash !== 'string' ||
        !SHA256.test(sourceHash)
      ) {
        throw new Error('AI_INVALID_FACT');
      }
      if (episodeId !== null) {
        requireWorkId(episodeId);
        const { data, error } = await serviceClient
          .from('episodes')
          .select('id,novel_id')
          .eq('id', episodeId)
          .maybeSingle();
        if (error) throw new AiStorageError();
        if (!data || String(data.novel_id) !== String(novelId)) {
          throw new Error('AI_ACCESS_DENIED');
        }
      }
      const { data, error } = await serviceClient
        .from('novelight_ai_bible_facts')
        .insert({
          novel_id: novelId,
          source_episode_id: episodeId,
          fact_kind: kind,
          fact_key: key,
          fact_payload: payload,
          provenance: 'ai_inferred',
          source_hash: sourceHash,
          updated_at: new Date().toISOString()
        })
        .select('id,revision,provenance')
        .single();
      // Never let AI overwrite a human-confirmed fact on conflict. A changed
      // source version must be reviewed in a later explicitly-authorized flow.
      if (error?.code === '23505') {
        return { unchanged: true };
      }
      if (error || !data) throw new AiStorageError();
      return data;
    }
  });
}
