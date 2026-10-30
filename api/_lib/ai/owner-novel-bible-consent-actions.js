// Phase 02-07-04: dormant server-only explicit consent grant/revoke workflow.
// NOT mounted by any HTTP route. Does not call models, alter budgets, or grant
// access to AI analysis. DB RPCs must be separately reviewed/migrated.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[a-z0-9][a-z0-9._-]{3,119}$/i;
const PROCESSORS = new Set(['openai', 'gemini']);

function denied() {
  throw new Error('AI_CONSENT_ACTION_DENIED');
}

function unavailable() {
  throw new Error('AI_CONSENT_ACTION_UNAVAILABLE');
}

export function createOwnerNovelBibleConsentActions({
  enabled = false,
  ownerId,
  authClient,
  serviceClient,
  policyRevision
} = {}) {
  if (
    typeof ownerId !== 'string' ||
    !UUID.test(ownerId) ||
    typeof policyRevision !== 'string' ||
    !REVISION.test(policyRevision) ||
    typeof authClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function'
  ) {
    unavailable();
  }
  const owner = ownerId.toLowerCase();

  async function authorize({
    token,
    novelId,
    processor,
    explicitAuthorAction
  }) {
    if (!enabled) throw new Error('AI_CONSENT_ACTION_DISABLED');
    if (
      explicitAuthorAction !== true ||
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/u.test(token) ||
      !Number.isSafeInteger(novelId) ||
      novelId < 1 ||
      !PROCESSORS.has(processor)
    ) {
      denied();
    }
    try {
      // Never accept actor_id from the browser. Verify the bearer on EVERY
      // action, then check actual current work ownership independently.
      const identity = await authClient.auth.getUser(token);
      if (
        identity?.error ||
        typeof identity?.data?.user?.id !== 'string' ||
        identity.data.user.id.toLowerCase() !== owner
      ) {
        denied();
      }
      const novel = await serviceClient
        .from('novels')
        .select('id,user_id')
        .eq('id', novelId)
        .maybeSingle();
      if (
        novel?.error ||
        novel?.data?.id !== novelId ||
        novel.data.user_id?.toLowerCase() !== owner
      ) {
        denied();
      }
    } catch {
      // Do not reveal JWT, Supabase details or any private owner records.
      denied();
    }
  }

  // This call records an explicit author action; it never starts a trial.
  // The future UI must show provider, purpose, retention, overseas processing
  // and current policy text BEFORE enabling the accept action.
  async function grant({
    token,
    novelId,
    processor,
    explicitAuthorAction = false,
    acceptedExternalProcessing = false,
    acceptedDisclosureRevision
  } = {}) {
    await authorize({ token, novelId, processor, explicitAuthorAction });
    if (
      acceptedExternalProcessing !== true ||
      acceptedDisclosureRevision !== policyRevision
    ) {
      denied();
    }
    try {
      const result = await serviceClient.rpc('novelight_ai_consent_grant', {
        p_actor_id: owner,
        p_novel_id: novelId,
        p_processor: processor,
        p_policy_revision: policyRevision
      });
      const row = result?.data;
      if (
        result?.error ||
        row?.status !== 'granted' ||
        row.processor !== processor ||
        row.policyRevision !== policyRevision ||
        typeof row.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(row.expiresAt))
      ) {
        unavailable();
      }
      return Object.freeze({
        novelId,
        processor,
        status: 'granted',
        policyRevision,
        expiresAt: row.expiresAt,
        aiEnabled: false
      });
    } catch {
      unavailable();
    }
  }

  // Revocation must never require a fresh consent checkbox. It takes effect
  // against future calls; an already-sent third-party request cannot be
  // recalled. A new grant always requires another explicit author action.
  async function revoke({
    token,
    novelId,
    processor,
    explicitAuthorAction = false
  } = {}) {
    await authorize({ token, novelId, processor, explicitAuthorAction });
    try {
      const result = await serviceClient.rpc('novelight_ai_consent_revoke', {
        p_actor_id: owner,
        p_novel_id: novelId,
        p_processor: processor
      });
      const row = result?.data;
      if (
        result?.error ||
        row?.status !== 'revoked' ||
        row.processor !== processor ||
        typeof row.revokedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.revokedAt))
      ) {
        unavailable();
      }
      return Object.freeze({
        novelId,
        processor,
        status: 'revoked',
        aiEnabled: false
      });
    } catch {
      unavailable();
    }
  }

  return Object.freeze({ grant, revoke });
}
