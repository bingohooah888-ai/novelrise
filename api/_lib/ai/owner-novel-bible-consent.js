// Phase 02-07-04: read-only, default-OFF external processing consent gate.
// Not mounted in HTTP, not wired to the owner trial runtime and cannot grant
// consent. A separately approved migration and author action are required.
// Bind to the exact approved provider routes: fallback needs consent too.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[a-z0-9][a-z0-9._-]{3,119}$/i;
const PROVIDERS = new Set(['openai', 'gemini']);
const PURPOSE = 'external-novel-bible-analysis';

function unavailable() {
  throw new Error('AI_CONSENT_GATE_UNAVAILABLE');
}

function validId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) {
    return null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

// All checks are repeated on every call; no grant result is cached. Callers
// use this exact function as permissionCheck in the existing owner-only model
// bridge and Router. This alone does not authorize any model execution.
export function createOwnerNovelBibleConsentPermissionCheck({
  enabled = false,
  ownerId,
  serviceClient,
  routes,
  policyRevision,
  now = Date.now
} = {}) {
  const selected = routes?.['novel-bible'];
  if (
    typeof ownerId !== 'string' ||
    !UUID.test(ownerId) ||
    typeof serviceClient?.from !== 'function' ||
    typeof policyRevision !== 'string' ||
    !REVISION.test(policyRevision) ||
    typeof now !== 'function' ||
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 2 ||
    selected.some(
      (route) =>
        !route ||
        !PROVIDERS.has(route.provider) ||
        typeof route.model !== 'string' ||
        !/^[a-z0-9._-]{1,100}$/i.test(route.model)
    )
  ) {
    unavailable();
  }
  // Consent is for each processor receiving the excerpt, not only the
  // preferred model. Any later fallback route change needs a new gate.
  const processors = [...new Set(selected.map((route) => route.provider))];
  const owner = ownerId.toLowerCase();

  return async function permissionCheck({
    actorId,
    novelId,
    episodeId,
    purpose
  } = {}) {
    if (
      !enabled ||
      typeof actorId !== 'string' ||
      actorId.toLowerCase() !== owner ||
      purpose !== PURPOSE ||
      !validId(novelId) ||
      !validId(episodeId)
    ) {
      return false;
    }

    try {
      const current = now();
      if (!Number.isSafeInteger(current) || current < 0) return false;

      // Never trust a novel/episode ID supplied by the browser as proof of
      // ownership; verify current authoritative rows before reading grants.
      const novel = await serviceClient
        .from('novels')
        .select('id,user_id')
        .eq('id', novelId)
        .maybeSingle();
      if (
        novel?.error ||
        novel?.data?.id !== novelId ||
        novel?.data?.user_id?.toLowerCase() !== owner
      ) {
        return false;
      }
      const episode = await serviceClient
        .from('episodes')
        .select('id,novel_id')
        .eq('id', episodeId)
        .maybeSingle();
      if (
        episode?.error ||
        episode?.data?.id !== episodeId ||
        episode?.data?.novel_id !== novelId
      ) {
        return false;
      }

      const response = await serviceClient
        .from('novelight_ai_external_processing_consents')
        .select('processor,policy_revision,granted_at,expires_at,revoked_at')
        .eq('actor_id', owner)
        .eq('novel_id', novelId)
        .eq('purpose', PURPOSE)
        .in('processor', processors)
        .limit(processors.length + 1);
      const rows = response?.data;
      if (
        response?.error ||
        !Array.isArray(rows) ||
        rows.length !== processors.length
      ) {
        return false;
      }

      const seen = new Set();
      for (const row of rows) {
        if (
          !row ||
          !processors.includes(row.processor) ||
          seen.has(row.processor) ||
          row.policy_revision !== policyRevision ||
          row.revoked_at !== null
        ) {
          return false;
        }
        const grantedAt = validTimestamp(row.granted_at);
        const expiresAt = validTimestamp(row.expires_at);
        if (
          grantedAt === null ||
          expiresAt === null ||
          grantedAt > current ||
          expiresAt <= current ||
          expiresAt <= grantedAt
        ) {
          return false;
        }
        seen.add(row.processor);
      }
      return seen.size === processors.length;
    } catch {
      // Missing table, network failure, malformed response, unavailable
      // Staging/Production DB => never infer consent from an error.
      return false;
    }
  };
}
