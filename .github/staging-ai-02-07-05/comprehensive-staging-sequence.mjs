// AI 02-07-05: one bounded Staging execution sequence, not an entrypoint.
// Reuses the existing protected paid composition and externally approved
// Staging adapters; importing/constructing this module performs NO I/O.
// Do not mount under api/, invoke from a PR workflow, or interpret the
// existence of this sequence as OWNER approval or permission to deploy.

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
 * by themselves are NOT authentication. A trusted main-only caller must
 * inject the existing protected paid composition, never an unreviewed PR
 * implementation. Watchdog, durable claim and billing remain in that module.
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
  beforeSynthetic = async () => true,
  runSyntheticJwtProof,
  getProtectedPaidConfig,
  stopAndCleanup,
  independentFinalCensus,
  protectedPaidFactory
} = {}) {
  if (!validScope(scope) ||
      [
        verifyOwnerAndRefs,
        verifyStagingIsolation,
        installReviewState,
        installChunkClaim,
        preparePreview,
        beforeSynthetic,
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
      let preflightPassed = false;
      let syntheticStarted = false;
      let paidStarted = false;
      let failed = false;
      let cleanupOk = true;
      let censusOk = true;
      let completed = false;
      try {
        if (await verifyOwnerAndRefs(scope) !== true ||
            await verifyStagingIsolation(scope) !== true) deny();
        preflightPassed = true;

        // A later SHA change invalidates the approval at EACH mutation gate.
        if (await verifyOwnerAndRefs(scope) !== true ||
            await installReviewState(scope) !== true) deny();
        if (await verifyOwnerAndRefs(scope) !== true ||
            await installChunkClaim(scope) !== true) deny();
        if (await verifyOwnerAndRefs(scope) !== true) deny();
        const preview = await preparePreview(scope);
        if (!exactPreview(preview, scope)) deny();
        // The live binding requires a signed ARM and OWNER claim here.
        if (await beforeSynthetic(scope) !== true) deny();

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
        if (syntheticStarted && !completed) {
          // On a failed run, independently stop and reconcile the synthetic
          // fixture. This callback MUST tolerate the paid executor having
          // already cleaned it; permanent claim tombstones remain untouched.
          // A successful protected paid run has already stopped/cleaned.
          try {
            cleanupOk = (await stopAndCleanup(scope, {
              paidStarted
            })) === true;
          } catch {
            cleanupOk = false;
          }
        }
        if (preflightPassed) {
          try {
            censusOk = (await independentFinalCensus(scope)) === true;
          } catch {
            censusOk = false;
          }
        }
      }
      if (failed || !completed || !cleanupOk || !censusOk) {
        deny();
      }
      // No original manuscript, JWT, personal data, request, or model text.
      return Object.freeze({
        outcome: 'STAGING_SEQUENCE_PASS',
        projectRef: STAGING,
        candidateSha: scope.candidateSha,
        migrationsInstalled: scope.existingMigrationsOnly === true ? 0 : 2,
        migrationsVerified: scope.existingMigrationsOnly === true,
        previewCount: scope.existingPreviewOnly === true ? 0 : 1,
        existingPreviewVerified: scope.existingPreviewOnly === true,
        paidAttempts: 1,
        syntheticCleanupVerified: true,
        retainedClaimsPreserved: true
      });
    }
  });
}

// Offline composition contract for A/B/C only. This is not a trusted
// entrypoint: the reviewed main caller must supply the genuine independent
// Gate A result, OWNER one-use admission, and reviewed proof-only adapters.
// A signed ARM alone is not the completed Gate A result. Never pass a
// paid OWNER approval or the paid binding here to simulate zero cost.
// prettier-ignore
export function create020705UnpaidGateABCSequence({
  scope, verifyOwnerAndRefs, verifyIndependentGateA,
  verifyStagingIsolation, inspectInstalled, preparePreview,
  beforeSynthetic, runSyntheticJwtProof, stopAndCleanup,
  independentFinalCensus
} = {}) {
  if (scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGING || scope?.supabaseUrl !== URL ||
      scope?.protectedEnvironment !== 'staging' ||
      scope?.trustedRef !== 'refs/heads/main' || scope?.prNumber !== 2895 ||
      !SHA.test(scope?.mainSha ?? '') || !SHA.test(scope?.candidateSha ?? '') ||
      scope.mainSha === scope.candidateSha ||
      !BRANCH.test(scope?.stagingBranch ?? '') ||
      !DEPLOYMENT.test(scope?.previewDeploymentId ?? '') ||
      !Number.isSafeInteger(scope?.approvalCommentId) || scope.approvalCommentId <= 0 ||
      !Number.isSafeInteger(scope?.runId) || scope.runId <= 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(scope?.actorId ?? '') ||
      !Number.isSafeInteger(scope?.novelId) || scope.novelId <= 0 ||
      !Number.isSafeInteger(scope?.episodeId) || scope.episodeId <= 0 ||
      scope.maxMigrations !== 0 || scope.maxPreviews !== 0 ||
      scope.existingMigrationsOnly !== true || scope.existingPreviewOnly !== true ||
      scope.maxPaidCalls !== 0 || scope.capMicros !== 0 ||
      [verifyOwnerAndRefs, verifyIndependentGateA, verifyStagingIsolation,
        inspectInstalled, preparePreview, beforeSynthetic, runSyntheticJwtProof,
        stopAndCleanup, independentFinalCensus].some((fn) => typeof fn !== 'function'))
    deny();
  scope = Object.freeze({ ...scope });
  let attempted = false;

  return Object.freeze({
    async run() {
      if (attempted) deny();
      attempted = true;
      let syntheticStarted = false;
      let proofPassed = false;
      let cleanupOk = false;
      let censusOk = false;
      try {
        if (await verifyOwnerAndRefs(scope) !== true ||
            await verifyIndependentGateA(scope) !== true ||
            await verifyStagingIsolation(scope) !== true ||
            await inspectInstalled(scope) !== true) deny();
        const preview = await preparePreview(scope);
        if (!exactPreview(preview, scope) ||
            preview.id !== scope.previewDeploymentId) deny();
        // Revalidate at the write boundary. Admission must consume a
        // separately approved non-paid scope, not the paid OWNER ledger.
        if (await verifyOwnerAndRefs(scope) !== true ||
            await verifyIndependentGateA(scope) !== true ||
            await beforeSynthetic(scope) !== true) deny();
        syntheticStarted = true;
        const proof = await runSyntheticJwtProof(scope);
        if (!exactSynthetic(proof, scope) ||
            proof.actorId !== scope.actorId || proof.novelId !== scope.novelId ||
            proof.episodeId !== scope.episodeId ||
            await verifyOwnerAndRefs(scope) !== true) deny();
        proofPassed = true;
      } catch {
        // Redact all adapter errors; never retry an attempted proof.
      } finally {
        if (syntheticStarted) {
          try {
            cleanupOk = (await stopAndCleanup(scope, { paidStarted: false })) === true;
          } catch { /* retain failure */ }
          try {
            censusOk = (await independentFinalCensus(scope)) === true;
          } catch { /* retain failure */ }
        }
      }
      if (!proofPassed || !cleanupOk || !censusOk) deny();
      // These are orchestration results, not independently authenticated
      // live Gate A/B/C evidence or a grant of any execution authority.
      return Object.freeze({
        outcome: 'UNPAID_ABC_SEQUENCE_CONTRACT_VERIFIED',
        projectRef: STAGING,
        candidateSha: scope.candidateSha,
        previewDeploymentId: scope.previewDeploymentId,
        paidAttempts: 0,
        authorizesPaidCall: false,
        authorizesStagingWrite: false,
        authorizesPreviewCreation: false
      });
    }
  });
}
