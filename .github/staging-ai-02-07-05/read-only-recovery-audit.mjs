// 02-07-05 — offline-only read-only recovery audit composition.
// No GitHub API calls, writes, secrets, AI calls, or workflow entrypoint.
// The caller must supply an authenticated complete OWNER-ledger snapshot,
// plus independent Staging census evidence from separately reviewed readers.
import { inspect020705ReadOnlyOwnerLedger } from './owner-ledger-readonly-verifier.mjs';
import { plan020705IndependentRecovery } from './independent-recovery-plan.mjs';

const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const REPO = 'bingohooah888-ai/novelrise';
const MAX_CLOCK_SKEW_MS = 30000;
function deny() {
  throw new Error('AI_020705_RECOVERY_AUDIT_DENIED');
}

export function audit020705RecoveryReadOnly({
  ledgerSnapshot,
  scope,
  stagingEvidence,
  now = Date.now
} = {}) {
  if (
    typeof now !== 'function' ||
    scope?.repository !== REPO ||
    scope?.issueNumber !== 294 ||
    scope?.stagingProjectRef !== STAGING_REF ||
    typeof ledgerSnapshot !== 'object' ||
    !stagingEvidence ||
    typeof stagingEvidence !== 'object'
  ) deny();

  const observedNow = now();
  if (
    !Number.isFinite(observedNow) ||
    !Number.isFinite(ledgerSnapshot?.observedAtMs) ||
    !Number.isFinite(stagingEvidence.observedAtMs) ||
    Math.abs(ledgerSnapshot.observedAtMs - stagingEvidence.observedAtMs) >
      MAX_CLOCK_SKEW_MS ||
    stagingEvidence.projectRef !== STAGING_REF ||
    stagingEvidence.mainSha !== scope.mainSha ||
    stagingEvidence.previewDeploymentId !== scope.previewDeploymentId ||
    stagingEvidence.approvalCommentId !== scope.approvalCommentId ||
    stagingEvidence.runId !== scope.runId ||
    !Number.isSafeInteger(stagingEvidence.novelId) ||
    stagingEvidence.novelId !== scope.novelId ||
    !Number.isSafeInteger(stagingEvidence.episodeId) ||
    stagingEvidence.episodeId !== scope.episodeId ||
    stagingEvidence.actorId !== scope.actorId ||
    typeof stagingEvidence.stagingRuntimeOffZero !== 'boolean' ||
    typeof stagingEvidence.syntheticCensusZero !== 'boolean' ||
    typeof stagingEvidence.stagingEnvironmentDisabled !== 'boolean'
  ) deny();

  // Do not accept a caller-provided "claimed"/"consumed" flag. Only the
  // full, independently inspected GitHub ledger determines that state.
  let ledger;
  try {
    ledger = inspect020705ReadOnlyOwnerLedger({
      snapshot: ledgerSnapshot, scope, now: observedNow
    });
  } catch {
    deny();
  }

  let plan;
  try {
    plan = plan020705IndependentRecovery({
      scope: {
        projectRef: STAGING_REF,
        mainSha: scope.mainSha,
        previewDeploymentId: scope.previewDeploymentId,
        approvalCommentId: scope.approvalCommentId,
        runId: scope.runId
      },
      evidence: {
        projectRef: STAGING_REF,
        mainSha: scope.mainSha,
        previewDeploymentId: scope.previewDeploymentId,
        approvalCommentId: scope.approvalCommentId,
        runId: scope.runId,
        observedAtMs: stagingEvidence.observedAtMs,
        claimed: ledger.claimed,
        consumed: ledger.consumed,
        stagingRuntimeOffZero: stagingEvidence.stagingRuntimeOffZero,
        syntheticCensusZero: stagingEvidence.syntheticCensusZero,
        stagingEnvironmentDisabled: stagingEvidence.stagingEnvironmentDisabled
      },
      now: () => observedNow
    });
  } catch {
    deny();
  }

  return Object.freeze({
    auditState: plan.status,
    ledgerState: ledger.status,
    noPaidRetry: true,
    authorizesPaidCall: false,
    authorizesMutation: false,
    // Suggested operations only: never a token, permission or instruction
    // to invoke a mutating workflow. A separate OWNER decision is required.
    proposedActions: Object.freeze([...plan.actions])
  });
}
