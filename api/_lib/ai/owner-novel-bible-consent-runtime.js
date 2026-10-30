// Phase 02-07-04: complete server-only consent read/grant/revoke adapter.
// It cannot process manuscripts, invoke a model or grant a trial entitlement.
// The HTTP endpoint retains its independent owner, origin and flag checks.
import { createOwnerNovelBibleConsentActions } from './owner-novel-bible-consent-actions.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[a-z0-9][a-z0-9._-]{3,119}$/i;
const PROCESSORS = new Set(['openai', 'gemini']);
const PURPOSE = 'external-novel-bible-analysis';

function unavailable() {
  throw new Error('AI_CONSENT_ACTION_UNAVAILABLE');
}

function denied() {
  throw new Error('AI_CONSENT_ACTION_DENIED');
}

function validText(value, max) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function validDisclosure(disclosure) {
  return (
    disclosure &&
    PROCESSORS.has(disclosure.processor) &&
    validText(disclosure.label, 80) &&
    validText(disclosure.purpose, 240) &&
    validText(disclosure.dataSent, 800) &&
    validText(disclosure.retention, 800) &&
    validText(disclosure.internationalTransfer, 800)
  );
}

// Explicit administrator-reviewed settings are required. No speculative
// provider privacy promises, international transfer terms or retention
// windows are embedded in production source code.
export function resolveOwnerNovelBibleConsentRuntimePolicy(env = {}) {
  if (
    env.NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED !== 'true' ||
    typeof env.NOVELIGHT_AI_CONSENT_POLICY_REVISION !== 'string' ||
    !REVISION.test(env.NOVELIGHT_AI_CONSENT_POLICY_REVISION) ||
    typeof env.NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON !== 'string' ||
    env.NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON.length > 5000
  ) {
    return null;
  }
  try {
    const disclosures = JSON.parse(env.NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON);
    if (
      !Array.isArray(disclosures) ||
      disclosures.length < 1 ||
      disclosures.length > 2 ||
      disclosures.some((item) => !validDisclosure(item)) ||
      new Set(disclosures.map((item) => item.processor)).size !==
        disclosures.length
    ) {
      return null;
    }
    return Object.freeze({
      policyRevision: env.NOVELIGHT_AI_CONSENT_POLICY_REVISION,
      disclosures: Object.freeze(
        disclosures.map((item) =>
          Object.freeze({
            processor: item.processor,
            label: item.label,
            purpose: item.purpose,
            dataSent: item.dataSent,
            retention: item.retention,
            internationalTransfer: item.internationalTransfer
          })
        )
      )
    });
  } catch {
    return null;
  }
}

export function createOwnerNovelBibleConsentRuntime({
  enabled = false,
  ownerId,
  serviceClient,
  policyRevision,
  disclosures,
  now = Date.now
} = {}) {
  if (
    typeof ownerId !== 'string' ||
    !UUID.test(ownerId) ||
    typeof policyRevision !== 'string' ||
    !REVISION.test(policyRevision) ||
    typeof serviceClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    !Array.isArray(disclosures) ||
    disclosures.length < 1 ||
    disclosures.length > 2 ||
    disclosures.some((item) => !validDisclosure(item)) ||
    new Set(disclosures.map((item) => item.processor)).size !==
      disclosures.length ||
    typeof now !== 'function'
  ) {
    unavailable();
  }
  const owner = ownerId.toLowerCase();
  const processors = disclosures.map((item) => item.processor);
  const actions = createOwnerNovelBibleConsentActions({
    enabled,
    ownerId: owner,
    authClient: serviceClient,
    serviceClient,
    policyRevision
  });

  async function verify(token, novelId) {
    if (!enabled) throw new Error('AI_CONSENT_ACTION_DISABLED');
    if (
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/u.test(token) ||
      !Number.isSafeInteger(novelId) ||
      novelId < 1
    ) {
      denied();
    }
    try {
      const identity = await serviceClient.auth.getUser(token);
      if (
        identity?.error ||
        identity?.data?.user?.id?.toLowerCase() !== owner
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
        novel?.data?.user_id?.toLowerCase() !== owner
      ) {
        denied();
      }
    } catch {
      denied();
    }
  }

  async function read({ token, novelId } = {}) {
    await verify(token, novelId);
    let rows;
    try {
      const result = await serviceClient
        .from('novelight_ai_external_processing_consents')
        .select('processor,policy_revision,granted_at,expires_at,revoked_at')
        .eq('actor_id', owner)
        .eq('novel_id', novelId)
        .eq('purpose', PURPOSE)
        .in('processor', processors)
        .limit(processors.length + 1);
      if (result?.error || !Array.isArray(result?.data)) unavailable();
      rows = result.data;
    } catch {
      unavailable();
    }
    if (rows.length > processors.length) unavailable();
    const byProcessor = new Map();
    for (const row of rows) {
      if (
        !row ||
        !processors.includes(row.processor) ||
        byProcessor.has(row.processor) ||
        typeof row.policy_revision !== 'string' ||
        typeof row.granted_at !== 'string' ||
        typeof row.expires_at !== 'string' ||
        (row.revoked_at !== null && typeof row.revoked_at !== 'string')
      ) {
        unavailable();
      }
      const granted = Date.parse(row.granted_at);
      const expires = Date.parse(row.expires_at);
      if (!Number.isFinite(granted) || !Number.isFinite(expires)) {
        unavailable();
      }
      byProcessor.set(row.processor, { row, granted, expires });
    }
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0) unavailable();

    const view = disclosures.map((item) => {
      const found = byProcessor.get(item.processor);
      let status = 'none';
      let expiresAt = null;
      if (found?.row.revoked_at !== null && found) {
        if (!Number.isFinite(Date.parse(found.row.revoked_at))) unavailable();
        status = 'revoked';
      } else if (
        found &&
        found.row.policy_revision === policyRevision &&
        found.granted <= current &&
        found.expires > current &&
        found.expires > found.granted
      ) {
        status = 'active';
        expiresAt = found.row.expires_at;
      }
      return Object.freeze({
        ...item,
        status,
        expiresAt
      });
    });
    return Object.freeze({
      novelId,
      policyRevision,
      aiEnabled: false,
      disclosures: Object.freeze(view)
    });
  }

  function requireProcessor(processor) {
    if (!processors.includes(processor)) denied();
  }

  return Object.freeze({
    read,
    async grant(args = {}) {
      requireProcessor(args.processor);
      return actions.grant(args);
    },
    async revoke(args = {}) {
      requireProcessor(args.processor);
      return actions.revoke(args);
    }
  });
}
