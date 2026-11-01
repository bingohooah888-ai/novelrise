// 02-07-05 OFFLINE planning checklist only. Not an admission gate.
// It reads no environment, keys, GitHub ledger, databases, provider APIs or JWT.
// A green checklist NEVER authorizes a Preview, an AI call or a DB mutation.
const SHA = /^[a-f0-9]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const MAX_MICROS = 10000000;
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';

function positiveSafe(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function auditAi020705PaidTrialPlan(evidence = {}) {
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  const estimate = e.estimateMicros;
  const caps = e.budgetCapsMicros;
  const checks = {
    main_sha_pinned:
      SHA.test(e.mainSha ?? '') &&
      e.targetSha === e.mainSha &&
      e.previewSha === e.mainSha,
    dedicated_ready_preview:
      e.previewReady === true &&
      DEPLOYMENT.test(e.previewDeploymentId ?? '') &&
      e.previewIsProduction === false,
    staging_isolated:
      e.supabaseProjectRef === STAGING_REF &&
      e.productionIsolated === true &&
      e.stagingCredentialsOnly === true,
    synthetic_owner_scope:
      e.sourceKind === 'synthetic_non_sensitive' &&
      e.ownerVerified === true &&
      positiveSafe(e.novelId) &&
      positiveSafe(e.episodeId) &&
      e.chunkIndex === 0,
    one_provider_one_call:
      e.provider === 'openai' &&
      e.model === 'gpt-5.6-luna' &&
      e.routeCount === 1 &&
      e.maxProviderCalls === 1 &&
      e.fallbackDisabled === true &&
      e.automaticRetryDisabled === true,
    provider_access_and_terms:
      e.modelAccessVerified === true &&
      e.providerDataTermsVerified === true &&
      e.providerBillingControlsVerified === true,
    lawful_explicit_consent:
      e.sourceRightsVerified === true &&
      e.consentRevisionVerified === true &&
      e.explicitAuthorConsentVerified === true,
    estimate_within_ten_yen:
      e.priceVerifiedAtExecution === true &&
      e.fxAndBufferVerified === true &&
      positiveSafe(estimate) &&
      estimate <= MAX_MICROS,
    budget_plan_within_ten_yen:
      e.baselineAiOffAndZero === true &&
      Array.isArray(caps) &&
      caps.length === 4 &&
      caps.every(
        (cap) =>
          positiveSafe(cap) &&
          cap >= estimate &&
          cap <= MAX_MICROS
      ),
    maximum_one_hour:
      positiveSafe(e.expiryMinutes) && e.expiryMinutes <= 60,
    separate_single_use_authorization:
      e.approvalScopedToExactTarget === true &&
      e.dedicatedLedgerImplemented === true &&
      e.atomicClaimBeforeSecretsProven === true &&
      e.replayAndParallelRunDenied === true,
    abort_and_cleanup:
      e.killSwitchAndBudgetResetPlanVerified === true &&
      e.cleanupIncludesUsageAndConsentAudit === true &&
      e.finalCensusProofPlanned === true &&
      e.failuresDoNotAutoRetry === true
  };
  const missingChecks = Object.keys(checks).filter((name) => !checks[name]);
  return Object.freeze({
    kind: 'OFFLINE_EVIDENCE_AUDIT_ONLY',
    status:
      missingChecks.length === 0
        ? 'READY_FOR_SEPARATE_HUMAN_APPROVAL_ONLY'
        : 'NO_GO',
    maxMicros: MAX_MICROS,
    missingChecks: Object.freeze(missingChecks),
    authorizesExecution: false,
    mayCallProvider: false,
    mayModifyDatabase: false,
    mayCreatePreview: false
  });
}
