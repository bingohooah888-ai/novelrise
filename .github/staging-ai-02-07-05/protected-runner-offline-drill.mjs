// 02-07-05 — protected runner OFFLINE proof drill.
// Reuses the six existing fail-closed proof validators; this module NEVER
// constructs service clients, tokens, JWTs, a provider, or a live executor.
import { create020705ReadOnlyStageProofs } from './stage-readonly-proofs.mjs';

const PROOFS = Object.freeze([
  'verifyCurrentMain',
  'verifyProtectedRunner',
  'verifyApprovedPreview',
  'verifyAtomicMigration',
  'verifySyntheticConsent',
  'verifyProviderBillingLimit'
]);

function deny() {
  throw new Error('AI_020705_PROTECTED_RUNNER_DRYRUN_DENIED');
}

export async function inspect020705ProtectedRunnerOffline({
  approved, observers, now = Date.now
} = {}) {
  let verifiers;
  try {
    verifiers = create020705ReadOnlyStageProofs({ approved, observers, now });
  } catch {
    deny();
  }
  const scope = Object.freeze({
    repository: approved.repository,
    stagingProjectRef: approved.stagingProjectRef,
    mainSha: approved.mainSha,
    previewDeploymentId: approved.previewDeploymentId,
    approvalCommentId: approved.approvalCommentId,
    runId: approved.runId,
    novelId: approved.novelId,
    episodeId: approved.episodeId
  });
  const checked = [];
  let blocked = false;
  for (const name of PROOFS) {
    // Stop at the first failed observation. In particular, never request
    // downstream consent/billing evidence after a SHA or protection mismatch.
    // These callbacks remain offline/read-only and unauthenticated here.
    if (blocked) {
      checked.push(Object.freeze({name, verified: false, skipped: true}));
      continue;
    }
    const valid = await verifiers[name](scope);
    blocked = valid !== true;
    checked.push(Object.freeze({name, verified: valid === true, skipped: false}));
  }
  const passed = checked.every(x => x.verified);
  return Object.freeze({
    status: passed ? 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH'
      : 'PROTECTED_RUNNER_PROOFS_INCOMPLETE_NO_GO',
    checks: Object.freeze(checked),
    provenanceAuthenticated: false,
    externalKillSwitchVerified: false,
    independentWatchdogRunning: false,
    approvedPreviewCreated: false,
    authorizesExecution: false,
    authorizesStagingWrite: false,
    authorizesPaidCall: false,
    authorizesRealJwt: false,
    noPaidRetry: true
  });
}
