// AI 02-07-05: one bounded Staging execution sequence, not an entrypoint.
// Reuses the existing protected paid composition and externally approved
// Staging adapters; importing/constructing this module performs NO I/O.
// Do not mount under api/, invoke from a PR workflow, or interpret the
// existence of this sequence as OWNER approval or permission to deploy.
import { create020705ProtectedLiveComposition } from '../ai-02-07-05-app-composition/protected-live-composition.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const SHA = /^[a-f0-9]{40}$/u;
const BRANCH = /^staging\/ai-02-07-05-[a-z0-9-]+$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;

function deny() {
  throw new Error('AI_020705_STAGING_SEQUENCE_DENIED');
}

function validScope(scope) {
  return scope?.repository === REPO &&
    scope?.stagingProjectRef === STAGING &&
    scope?.supabaseUrl === URL &&
    scope?.protectedEnvironment === 'staging' &&
    scope?.trustedRef === 'refs/heads/main' &&
    scope?.prNumber === 2895 &&
    SHA.test(scope?.mainSha ?? '') &&
    SHA.test(scope?.candidateSha ?? '') &&
    scope.mainSha !== scope.candidateSha &&
    BRANCH.test(scope?.stagingBranch ?? '') &&
    Number.isSafeInteger(scope?.approvalCommentId) &&
    scope.approvalCommentId > 0 &&
    Number.isSafeInteger(scope?.runId) &&
    scope.runId > 0 &&
    scope?.maxMigrations === 2 &&
    scope?.maxPreviews === 1 &&
    scope?.maxPaidCalls === 1 &&
    Number.isSafeInteger(scope?.capMicros) &&
    scope.capMicros > 0 &&
    scope.capMicros <= 10000000;
}

function exactPreview(preview, scope) {
  return preview?.id && DEPLOYMENT.test(preview.id) &&
    preview?.target === 'preview' &&
    preview?.ready === true &&
    preview?.gitCommitSha === scope.candidateSha &&
    preview?.gitBranch === scope.stagingBranch &&
    preview?.supabaseUrl === URL &&
    preview?.projectRef === STAGING &&
    preview?.ssoProtected === true;
}

function exactSynthetic(proof, scope) {
  return proof?.verifiedSynthetic === true &&
    proof?.realSignedJwt === true &&
    proof?.ownerOnly === true &&
    proof?.rlsDeniedOtherActor === true &&
    proof?.revokedSessionDenied === true &&
    proof?.casConflictDenied === true &&
    proof?.claimOnceDeniedReplay === true &&
    proof?.stagingProjectRef === STAGING &&
    proof?.candidateSha === scope.candidateSha;
}

/**
 * A protected, reviewed main-only caller must provide independent genuine
 * OWNER/SHA, Staging, migration, Preview and JWT observers. Boolean adapters
 * by themselves are NOT authentication. The paid factory is the existing
 * protected live composition: signed independent watchdog, durable claim,
 * externally enforceable budget, single provider call and cleanup stay there.
 *
 * This sequence never repairs migration history, retries, drops claims,
 * changes Production, or implicitly creates Preview/paid permissions.
 */
export function create020705ComprehensiveStagingSequence({
  scope,
  verifyOwnerAndRefs,
  verifyStagingIsolation,
  installReviewState,
  installChunkClaim,
  preparePreview,
  runSyntheticJwtProof,
  getProtectedPaidConfig,
  stopAndCleanup,
  independentFinalCensus,
  protectedPaidFactory = create020705ProtectedLiveComposition
} = {}) {
  if (!validScope(scope) ||
      [
        verifyOwnerAndRefs,
        verifyStagingIsolation,
        installReviewState,
        installChunkClaim,
        preparePreview,
        runSyntheticJwtProof,
        getProtectedPaidConfig,
        stopAndCleanup,
        independentFinalCensus,
        protectedPaidFactory
      ].some((callback) => typeof callback !== 'function')) deny();

  let attempted = false;
  return Object.freeze({
    async run() {
      if (attempted) deny();
      attempted = true;
      let syntheticStarted = false;
      let paidStarted = false;
      let failed = false;
      let cleanupOk = true;
      let censusOk = false;
      let completed = false;
      let errorCode = 'AI_020705_STAGING_SEQUENCE_DENIED';
      try {
        if (await verifyOwnerAndRefs(scope) !== true ||
            await verifyStagingIsolation(scope) !== true) deny();

        // A later SHA change invalidates the approval at EACH mutation gate.
        if (await verifyOwnerAndRefs(scope) !== true ||
            await installReviewState(scope) !== true) deny();
        if (await verifyOwnerAndRefs(scope) !== true ||
            await installChunkClaim(scope) !== true) deny();
        if (await verifyOwnerAndRefs(scope) !== true) deny();
        const preview = await preparePreview(scope);
        if (!exactPreview(preview, scope)) deny();

        // The trusted probe owns synthetic fixture lifecycle and MUST
        // report its creation before attempting any JWT-bound operation.
        syntheticStarted = true;
        const proof = await runSyntheticJwtProof(Object.freeze({
          ...scope,
          previewDeploymentId: preview.id
        }));
        if (!exactSynthetic(proof, scope)) deny();
        if (await verifyOwnerAndRefs(scope) !== true) deny();

        const paidConfig = await getProtectedPaidConfig(Object.freeze({
          ...scope,
          previewDeploymentId: preview.id
        }), proof);
        if (paidConfig?.context?.previewDeploymentId !== preview.id ||
            paidConfig?.context?.mainSha !== scope.mainSha ||
            paidConfig?.context?.candidateSha !== scope.candidateSha ||
            paidConfig?.expected?.candidateSha !== scope.candidateSha ||
            paidConfig?.expected?.capMicros !== scope.capMicros ||
            paidConfig?.synthetic?.projectRef !== STAGING) deny();

        // No provider code is duplicated here. The existing protected
        // composition enforces the signed external arm and atomic one-shot.
        const paid = protectedPaidFactory(paidConfig);
        if (typeof paid?.run !== 'function') deny();
        paidStarted = true;
        const outcome = await paid.run();
        if (outcome?.outcome !== 'one_call_succeeded_and_cleanup_verified') {
          deny();
        }
        completed = true;
      } catch {
        failed = true;
      } finally {
        if (syntheticStarted) {
          // Idempotent emergency stop + fixture cleanup must be supplied by
          // the independent protected runner. Never delete claim tombstones.
          // The paid runner also performs its own stop/cleanup/census.
          try {
            cleanupOk = (await stopAndCleanup(scope, {
              paidStarted
            })) === true;
          } catch {
            cleanupOk = false;
          }
        }
        try {
          censusOk = (await independentFinalCensus(scope)) === true;
        } catch {
          censusOk = false;
        }
      }
      if (failed || !completed || !cleanupOk || !censusOk) {
        throw new Error(errorCode);
      }
      // No original manuscript, JWT, personal data, request, or model text.
      return Object.freeze({
        outcome: 'STAGING_SEQUENCE_PASS',
        projectRef: STAGING,
        candidateSha: scope.candidateSha,
        migrationsInstalled: 2,
        previewCount: 1,
        paidAttempts: 1,
        syntheticCleanupVerified: true,
        retainedClaimsPreserved: true
      });
    }
  });
}
