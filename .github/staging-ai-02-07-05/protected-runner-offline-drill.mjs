// 02-07-05 — protected runner OFFLINE proof drill.
// Reuses the six existing fail-closed proof validators; this module NEVER
// constructs service clients, tokens, JWTs, a provider, or a live executor.
import { create020705ReadOnlyStageProofs } from './stage-readonly-proofs.mjs';
import { inspect020705PreviewPrecreation } from './preview-precreation-readonly.mjs';
import { inspect020705DetachedSupervisorOffline } from './detached-supervisor-offline-drill.mjs';

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
  approved,
  observers,
  now = Date.now
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
  for (const name of PROOFS) {
    // Every check is read-only by CONTRACT. Its callback must be supplied
    // by a future authenticated runner; this does not verify provenance.
    const valid = await verifiers[name](scope);
    checked.push(Object.freeze({ name, verified: valid === true }));
  }
  const passed = checked.every((x) => x.verified);
  return Object.freeze({
    status: passed
      ? 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH'
      : 'PROTECTED_RUNNER_PROOFS_INCOMPLETE_NO_GO',
    checks: Object.freeze(checked),
    provenanceAuthenticated: false,
    externalKillSwitchVerified: false,
    independentWatchdogRunning: false,
    approvedPreviewCreated: false,
    // The actual GitHub workflow is verify-only. Matching mock proofs do
    // not create a dedicated real-JWT/DB-claim/paid-call execution path.
    missingLiveDependencies: Object.freeze([
      'OWNER_APPROVED_PROTECTED_WORKFLOW_WIRING',
      'EXACT_SHA_STAGING_PREVIEW_AND_SECRET_ISOLATION',
      'SYNTHETIC_REAL_JWT_AND_AUTH_REVOCATION',
      'ATOM_ONE_SHOT_CLAIM_AND_CLEANUP_PROOF',
      'PROVIDER_ENTITLEMENT_PRICE_AND_TEN_YEN_CAP',
      'DETACHED_WATCHDOG_AND_INDEPENDENT_ZERO_CENSUS'
    ]),
    authorizesExecution: false,
    authorizesStagingWrite: false,
    authorizesPaidCall: false,
    authorizesRealJwt: false,
    noPaidRetry: true
  });
}

/**
 * Compose the existing Gate A, B and C read-only contracts for ONE identical
 * synthetic run. Never creates an actual Preview, Watchdog, Runner, JWT, or
 * provider client. This does NOT authorize any real action, even when every
 * synthetic evidence contract matches.
 *
 * Reject mismatched scope before invoking an observer. Refuse to run the
 * simulated supervisor and runner if the Preview branch/secret metadata is
 * already unsafe. Inputs are only caller-injected offline observations.
 */
export async function inspect020705CombinedGateABCOffline({
  preview,
  supervisor,
  runner,
  now = Date.now
} = {}) {
  const denyCombined = () => {
    throw new Error('AI_020705_COMBINED_OFFLINE_DENIED');
  };
  try {
    const ps = preview?.scope;
    const as = supervisor?.scope;
    const cs = runner?.approved;
    if (
      typeof now !== 'function' ||
      !ps ||
      !as ||
      !cs ||
      typeof preview?.currentMain !== 'object' ||
      !/^[0-9a-f]{40}$/u.test(ps.mainSha ?? '') ||
      !/^[0-9a-f]{40}$/u.test(preview.stagingBranchHeadSha ?? '') ||
      as.issueNumber !== 294 ||
      !['repository', 'stagingProjectRef', 'mainSha'].every(
        (key) => ps[key] === as[key] && ps[key] === cs[key]
      ) ||
      ![
        'previewDeploymentId',
        'approvalCommentId',
        'runId',
        'actorId',
        'novelId',
        'episodeId'
      ].every((key) => as[key] === cs[key]) ||
      !/^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(ps.branch ?? '')
    )
      denyCombined();

    const previewResult = inspect020705PreviewPrecreation(preview);
    const previewMetadataEligible =
      previewResult.branchHeadMatchesMain === true &&
      previewResult.status ===
        'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL' &&
      previewResult.missingBranchScopedEnvNames.length === 0 &&
      previewResult.sharedCredentialsNeedingIsolationProof.length === 0;

    if (!previewMetadataEligible) {
      // Do not call any further observers for a known-bad Preview context.
      return Object.freeze({
        status: 'PREVIEW_PRECONDITIONS_NO_GO',
        gateB: previewResult,
        gateA: null,
        gateC: null,
        skippedFurtherOfflineObservations: true,
        stagingCredentialsVerified: false,
        authorizesMutation: false,
        authorizesExecution: false,
        authorizesPaidCall: false
      });
    }

    // Even a matching Preview is just metadata. Independent source transport
    // and credentials must be attested separately before any live test.
    const gateA = await inspect020705DetachedSupervisorOffline({
      ...supervisor,
      now
    });
    const gateC = await inspect020705ProtectedRunnerOffline({
      ...runner,
      now
    });
    if (
      gateA.authorizesMutation !== false ||
      gateA.authorizesPaidCall !== false ||
      gateC.authorizesExecution !== false ||
      gateC.authorizesPaidCall !== false
    )
      denyCombined();
    return Object.freeze({
      status: 'OFFLINE_CONTRACTS_CHECKED_LIVE_GATES_UNVERIFIED',
      gateB: previewResult,
      gateA,
      gateC,
      skippedFurtherOfflineObservations: false,
      stagingCredentialsVerified: false,
      authorizesMutation: false,
      authorizesExecution: false,
      authorizesPaidCall: false
    });
  } catch {
    // No thrown provider, JWT, token or callback message reaches the caller.
    denyCombined();
  }
}
