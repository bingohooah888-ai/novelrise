// AI 02-07-05 — Staging baseline read-only auditor.
// Not a live watcher, cleanup proof, permission grant or readiness signal.
// No default client, network request, env var, secret or CLI entrypoint.
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const PRODUCTION = 'fiepaguycecrredwrcwx';
const MAX_OBSERVATION_MS = 30000;
const SHA = /^[0-9a-f]{40}$/u;
const ZERO_COLUMNS = [
  'usage_requests', 'usage_audit', 'bible_facts', 'episode_analysis',
  'review_candidates', 'external_consents', 'external_consent_audit',
  'one_shot_claims'
];

// This SQL is SELECT-only, with a fixed set of public Staging tables and
// non-personal aggregate counters. A *separately authorized* query adapter
// MUST use a Staging-only read-only role/transaction and attest the origin.
// This module never supplies that adapter or any credentials.
export const AI_020705_STAGING_BASELINE_SQL = `
SELECT
  (SELECT count(*)::integer FROM public.novelight_ai_runtime_settings)
    AS runtime_rows,
  (SELECT enabled FROM public.novelight_ai_runtime_settings
    WHERE singleton = 1) AS enabled,
  (SELECT user_day_cap_micros FROM public.novelight_ai_runtime_settings
    WHERE singleton = 1) AS user_day_cap_micros,
  (SELECT user_month_cap_micros FROM public.novelight_ai_runtime_settings
    WHERE singleton = 1) AS user_month_cap_micros,
  (SELECT global_day_cap_micros FROM public.novelight_ai_runtime_settings
    WHERE singleton = 1) AS global_day_cap_micros,
  (SELECT global_month_cap_micros FROM public.novelight_ai_runtime_settings
    WHERE singleton = 1) AS global_month_cap_micros,
  (SELECT count(*)::integer FROM public.novelight_ai_usage_requests)
    AS usage_requests,
  (SELECT count(*)::integer FROM public.novelight_ai_usage_audit)
    AS usage_audit,
  (SELECT count(*)::integer FROM public.novelight_ai_bible_facts)
    AS bible_facts,
  (SELECT count(*)::integer FROM public.novelight_ai_episode_analysis)
    AS episode_analysis,
  (SELECT count(*)::integer FROM public.novelight_ai_review_candidates)
    AS review_candidates,
  (SELECT count(*)::integer FROM public.novelight_ai_external_processing_consents)
    AS external_consents,
  (SELECT count(*)::integer FROM public.novelight_ai_external_consent_action_audit)
    AS external_consent_audit,
  (SELECT count(*)::integer FROM public.novelight_ai_020705_one_shot_claims)
    AS one_shot_claims,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.novelight_ai_020705_one_shot_claims'::regclass)
    AS tombstone_rls,
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n
    ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'novelight_ai_020705_claim_once'
      AND p.prosecdef = false) AS invoker_claim_routines,
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n
    ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'novelight_ai_020705_claim_once'
      AND has_function_privilege('anon', p.oid, 'EXECUTE'))
    AS anon_executable_claim_routines,
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n
    ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'novelight_ai_020705_claim_once'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AS authenticated_executable_claim_routines,
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n
    ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'novelight_ai_020705_claim_once'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AS service_executable_claim_routines;`.trim();

function deny() {
  throw new Error('AI_020705_STAGING_BASELINE_DENIED');
}

/**
 * Independent live adapter contract: queryReadOnly({ projectRef, sql })
 * returns { projectRef, rows: [one aggregate row] }. The adapter must
 * enforce a read-only transaction and project identity outside this code.
 *
 * Any success is a point-in-time OFF/zero observation, NOT evidence of a
 * paid Staging trial or completion of fixture/session cleanup.
 */
export async function observe020705StagingBaseline({
  projectRef,
  mainSha,
  queryReadOnly,
  now = Date.now
} = {}) {
  if (projectRef !== STAGING || projectRef === PRODUCTION ||
      !SHA.test(mainSha ?? '') ||
      typeof queryReadOnly !== 'function' ||
      typeof now !== 'function') deny();
  const started = now();
  if (!Number.isFinite(started)) deny();

  try {
    const snapshot = await queryReadOnly(Object.freeze({
      projectRef: STAGING,
      sql: AI_020705_STAGING_BASELINE_SQL
    }));
    const ended = now();
    const row = snapshot?.rows?.[0];
    if (snapshot?.projectRef !== STAGING ||
        !Array.isArray(snapshot.rows) ||
        snapshot.rows.length !== 1 ||
        !row || typeof row !== 'object' ||
        !Number.isFinite(ended) ||
        ended < started ||
        ended - started > MAX_OBSERVATION_MS ||
        !Number.isSafeInteger(row.runtime_rows) ||
        row.runtime_rows !== 1 ||
        typeof row.enabled !== 'boolean' ||
        [
          'user_day_cap_micros', 'user_month_cap_micros',
          'global_day_cap_micros', 'global_month_cap_micros'
        ].some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0) ||
        ZERO_COLUMNS.some((key) =>
          !Number.isSafeInteger(row[key]) || row[key] < 0) ||
        typeof row.tombstone_rls !== 'boolean' ||
        [
          'invoker_claim_routines', 'anon_executable_claim_routines',
          'authenticated_executable_claim_routines',
          'service_executable_claim_routines'
        ].some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0)) {
      deny();
    }

    const offZero = row.enabled === false &&
      row.user_day_cap_micros === 0 &&
      row.user_month_cap_micros === 0 &&
      row.global_day_cap_micros === 0 &&
      row.global_month_cap_micros === 0 &&
      ZERO_COLUMNS.every((key) => row[key] === 0);
    const claimAclSafe = row.tombstone_rls === true &&
      row.invoker_claim_routines === 1 &&
      row.anon_executable_claim_routines === 0 &&
      row.authenticated_executable_claim_routines === 0 &&
      row.service_executable_claim_routines === 1;

    // Do not output business data or reusable authorization.
    return Object.freeze({
      projectRef: STAGING,
      mainSha,
      observedAtMs: ended,
      state: offZero && claimAclSafe
        ? 'STAGING_OFF_ZERO_AND_CLAIM_ACL_OBSERVED'
        : 'STAGING_BASELINE_NOT_SAFE',
      runtimeOffZeroObserved: offZero,
      claimAccessBoundaryObserved: claimAclSafe,
      authenticatedOriginVerified: false,
      independentExitVerified: false,
      syntheticCleanupVerified: false,
      authorizesPreview: false,
      authorizesStagingWrite: false,
      authorizesRealJwt: false,
      authorizesPaidCall: false,
      authorizesAiEnablement: false,
      noPaidRetry: true
    });
  } catch {
    // Raw database values/errors and credentials must not reach the caller.
    deny();
  }
}
