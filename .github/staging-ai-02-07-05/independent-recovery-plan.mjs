// 02-07-05 independent watchdog DECISION contract only. No I/O.
// An out-of-process, separately approved controller is required to perform
// any proposed Staging stop/cleanup. NEVER restart a paid model attempt.
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^dpl_[A-Za-z0-9]+$/u;
const STAGING = 'wmlzjgvxgoyrovdhbqbg';

function deny() {
  throw new Error('AI_020705_RECOVERY_EVIDENCE_DENIED');
}

export function plan020705IndependentRecovery({ scope, evidence, now = Date.now() } = {}) {
  if (
    scope?.projectRef !== STAGING ||
    !SHA.test(scope?.mainSha ?? '') ||
    !ID.test(scope?.previewDeploymentId ?? '') ||
    !Number.isSafeInteger(scope?.approvalCommentId) ||
    scope.approvalCommentId < 1 ||
    !Number.isSafeInteger(scope?.runId) ||
    scope.runId < 1 ||
    evidence?.projectRef !== STAGING ||
    evidence?.mainSha !== scope.mainSha ||
    evidence?.previewDeploymentId !== scope.previewDeploymentId ||
    evidence?.approvalCommentId !== scope.approvalCommentId ||
    evidence?.runId !== scope.runId ||
    !Number.isFinite(now) ||
    !Number.isFinite(evidence?.observedAtMs) ||
    evidence.observedAtMs > now ||
    now - evidence.observedAtMs > 300000 ||
    typeof evidence.claimed !== 'boolean' ||
    typeof evidence.consumed !== 'boolean' ||
    typeof evidence.stagingRuntimeOffZero !== 'boolean' ||
    typeof evidence.syntheticCensusZero !== 'boolean' ||
    typeof evidence.stagingEnvironmentDisabled !== 'boolean'
  ) deny();

  // A controller must not attempt a paid POST in ANY recovery state.
  const noPaidRetry = true;
  if (!evidence.claimed) {
    if (evidence.consumed) deny();
    return Object.freeze({
      status: 'UNCLAIMED_NO_EXECUTION_AUTHORIZED',
      noPaidRetry, actions: Object.freeze([])
    });
  }
  if (
    evidence.consumed &&
    evidence.stagingRuntimeOffZero &&
    evidence.syntheticCensusZero &&
    evidence.stagingEnvironmentDisabled
  ) {
    return Object.freeze({
      status: 'CONSUMED_AND_CLEANUP_VERIFIED',
      noPaidRetry, actions: Object.freeze([])
    });
  }
  // These are *proposed* operations, not authority to mutate.
  // A separate OWNER-approved recovery workflow must verify scope and
  // execute all stops even if a previous one fails, then independently
  // reobserve counters BEFORE claiming completion.
  const actions = [
    'DISABLE_STAGING_AI_AND_ZERO_BUDGET',
    'DISABLE_APPROVED_PREVIEW_ENVIRONMENT',
    'REVOKE_VERIFIED_SYNTHETIC_SESSIONS',
    'DELETE_VERIFIED_SYNTHETIC_FIXTURE',
    'RECHECK_INDEPENDENT_ZERO_CENSUS'
  ];
  if (!evidence.consumed) actions.push('APPEND_CONSUMED_TOMBSTONE');
  return Object.freeze({
    status: 'RECOVERY_REQUIRES_SEPARATE_OWNER_APPROVAL',
    noPaidRetry,
    actions: Object.freeze(actions)
  });
}
