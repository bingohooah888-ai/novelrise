// OFFLINE-ONLY persistence adapter for OWNER checklist review acknowledgements.
// Implements the injected readSnapshot + compareAndSwap contract from #2846.
// No Supabase client is created here, no browser route imports it, no DB schema
// exists until independently reviewed/applied in an authorized environment.
// Never reuse the AI candidate decision RPC: its status has different meaning.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^rv1-[0-9a-f]{16}$/;
const TABLE = 'novelight_ai_owner_review_states';
const RPC = 'novelight_ai_owner_review_state_cas';

function unavailable() {
  throw new Error('AI_OWNER_REVIEW_STATE_UNAVAILABLE');
}

function validateScope({ actorId, novelId, bearerToken }) {
  if (
    typeof actorId !== 'string' ||
    !UUID.test(actorId) ||
    !Number.isSafeInteger(novelId) ||
    novelId < 1 ||
    typeof bearerToken !== 'string' ||
    bearerToken.length < 16 ||
    bearerToken.length > 4096 ||
    /\s/.test(bearerToken)
  ) {
    unavailable();
  }
  return { actorId: actorId.toLowerCase(), novelId };
}

function validIds(ids) {
  return (
    Array.isArray(ids) &&
    ids.length <= 100 &&
    ids.every((id) => typeof id === 'string' && ID.test(id)) &&
    new Set(ids).size === ids.length
  );
}

function convertRow(row, actorId, novelId) {
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    row.actor_id !== actorId ||
    row.novel_id !== novelId ||
    row.version !== 1 ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !validIds(row.reviewed_ids)
  ) {
    unavailable();
  }
  return {
    actorId,
    novelId,
    version: 1,
    revision: row.revision,
    reviewedIds: [...row.reviewed_ids]
  };
}

// checkSession MUST be an independently trusted SERVER-ONLY function created
// with the existing createOfflineOwnerSessionCheck + cryptographic getClaims +
// scoped auth.sessions observer. A returned UUID is neither a browser input
// nor evidence that real Auth was tested; this adapter cannot certify it.
// The SQL RPC verifies the same session row again atomically while writing.
export function createSupabaseOwnerBibleReviewStateRepository({
  serviceClient,
  checkSession
} = {}) {
  if (
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    typeof checkSession !== 'function'
  ) {
    unavailable();
  }

  async function signedSession(scope, bearerToken) {
    let proof;
    try {
      proof = await checkSession({
        bearerToken,
        actorId: scope.actorId,
        novelId: scope.novelId
      });
    } catch {
      unavailable();
    }
    if (
      !proof ||
      proof.active !== true ||
      typeof proof.binding !== 'string' ||
      !UUID.test(proof.binding)
    ) {
      unavailable();
    }
    return proof.binding.toLowerCase();
  }

  return Object.freeze({
    async readSnapshot(args) {
      const scope = validateScope(args);
      const binding = await signedSession(scope, args.bearerToken);
      let response;
      try {
        response = await serviceClient
          .from(TABLE)
          .select('actor_id,novel_id,version,revision,reviewed_ids')
          .eq('actor_id', scope.actorId)
          .eq('novel_id', scope.novelId)
          .maybeSingle();
      } catch {
        unavailable();
      }
      if (response?.error || response?.data === undefined) unavailable();
      // Rechecking the same signed bearer before returning private data
      // makes mid-flight revoked sessions fail closed.
      const again = await signedSession(scope, args.bearerToken);
      if (again !== binding) unavailable();
      return response.data
        ? convertRow(response.data, scope.actorId, scope.novelId)
        : null;
    },

    async compareAndSwap(args) {
      const scope = validateScope(args);
      if (
        !Number.isSafeInteger(args.expectedRevision) ||
        args.expectedRevision < 0 ||
        args.expectedRevision >= 2147483647 ||
        !validIds(args.reviewedIds)
      ) {
        unavailable();
      }
      const binding = await signedSession(scope, args.bearerToken);
      let response;
      try {
        response = await serviceClient.rpc(RPC, {
          p_actor_id: scope.actorId,
          p_novel_id: scope.novelId,
          p_session_id: binding,
          p_expected_revision: args.expectedRevision,
          p_reviewed_ids: [...args.reviewedIds].sort()
        });
      } catch {
        unavailable();
      }
      if (
        response?.error ||
        !Array.isArray(response?.data) ||
        response.data.length > 1
      ) {
        unavailable();
      }
      // Empty RPC result means stale revision (no rows modified).
      if (response.data.length === 0) return null;
      const result = convertRow(response.data[0], scope.actorId, scope.novelId);
      if (
        result.revision !== args.expectedRevision + 1 ||
        result.reviewedIds.length !== args.reviewedIds.length ||
        result.reviewedIds.some((id) => !args.reviewedIds.includes(id))
      ) {
        unavailable();
      }
      return result;
    }
  });
}
