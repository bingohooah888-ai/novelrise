import { inspectPhase2SyntheticFixtureReadiness } from './community-phase2-synthetic-fixture-readiness.mjs';

// Phase 2 joint-hosted execution ordering contract.
// This is a dependency-injected library, not an executable workflow or grant.
// It has no credentials, HTTP client, filesystem side-effects or auto-run path.
const SCOPE = 'community-phase2-joint-hosted-authenticated-write';
const REPO = 'bingohooah888-ai/novelrise';
const PROD = 'fiepaguycecrredwrcwx';
const SHARED = 'wmlzjgvxgoyrovdhbqbg';
const VERCEL_TEAM = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const VERCEL_PROJECT = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const FEATURE_REF = 'feat/community-plaza-board-phase2-20261023';
const DEPLOY_ID = /^dpl_[a-zA-Z0-9]+$/u;
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;
const REF = /^[a-z0-9]{20}$/u;

export const PHASE2_HOSTED_SCOPE = SCOPE;
export const REQUIRED_PHASE2_HOSTED_OPERATIONS = Object.freeze([
  'freshOwnerLedgerAndCostBoundary',
  'reserveAndRecordOneUseClaim',
  'verifyIndependentProtectedGrant',
  'registerIndependentCleanupWatch',
  'createIsolatedBranch',
  'reconcileIsolatedBranch',
  'applyPinnedPhase2Schema',
  'provisionIsolatedSyntheticAccounts',
  'verifyIsolatedSyntheticAccounts',
  'enableIsolatedCommunityForProof',
  'createProtectedPreview',
  'reconcileProtectedPreview',
  'verifyIsolatedPreviewBinding',
  'runThreeRoleHostedAcceptance',
  'disableIsolatedCommunityAfterProof',
  'disposeProtectedPreview',
  'destroyIsolatedBranch',
  'readBackCleanup',
  'recordTerminalConsumption'
]);

export const REQUIRED_PHASE2_BROWSER_PROOFS = Object.freeze([
  'guestReadOnly',
  'authorCreatedThread',
  'readerCouldNotEditAuthorThread',
  'readerRepliedAndReported',
  'moderatorHidAndRestored',
  'ownerSoftDeleted',
  'phase1TimelineVerified',
  'phase2BoardVerified',
  'previewAndDbIdentityVerified'
]);

function stop(code) {
  throw new Error('COMMUNITY_PHASE2_HOSTED_DENIED: ' + code);
}
function sameRun(value, run) {
  return value?.runId === run.runId &&
    value?.requestCommentId === run.requestCommentId &&
    value?.mainSha === run.mainSha &&
    value?.candidateSha === run.candidateSha;
}
function requireOperation(operations, name) {
  if (typeof operations?.[name] !== 'function') stop('missing_' + name);
  return operations[name];
}
function validRun(run, operations) {
  if (
    run?.repository !== REPO || run?.scope !== SCOPE ||
    !SHA.test(run.mainSha ?? '') ||
    !SHA.test(run.candidateSha ?? '') ||
    run.mainSha === run.candidateSha ||
    !ID.test(run.runId ?? '') ||
    !ID.test(run.requestCommentId ?? '') ||
    REQUIRED_PHASE2_HOSTED_OPERATIONS.some((name) =>
      typeof operations?.[name] !== 'function')
  ) stop('untrusted_run_or_missing_adapter');
}
function checkBoundary(b, run) {
  if (
    !sameRun(b, run) || b.status !== 'PROTECTED_OWNER_BOUNDARY' ||
    b.ownerVerified !== true || b.ledgerOpenVerified !== true ||
    b.approvalUnusedVerified !== true || b.mainFreshVerified !== true ||
    b.candidatePinnedVerified !== true ||
    b.protectedEnvironmentVerified !== true ||
    b.oneUseBudgetCapEnforced !== true ||
    b.productionExcluded !== true ||
    b.independentCleanupReady !== true
  ) stop('owner_boundary_or_budget_not_proven');
}
function checkClaim(c, run) {
  if (
    !sameRun(c, run) || c.status !== 'ONE_USE_CLAIM_RECORDED' ||
    !ID.test(c.claimCommentId ?? '') || c.uniqueReservationVerified !== true ||
    c.consumedBefore !== false
  ) stop('ambiguous_one_use_claim');
}
function checkGrant(g, run, claim) {
  if (
    !sameRun(g, run) || g.status !== 'INDEPENDENT_PROTECTED_EXECUTION_GRANT' ||
    g.claimCommentId !== claim.claimCommentId ||
    g.scope !== SCOPE ||
    g.stagingCostApproved !== true || g.runAuthorized !== true ||
    g.writeAuthorized !== true ||
    g.oneUseBudgetCapEnforced !== true ||
    g.protectedEnvironmentVerified !== true ||
    g.productionMutationApproved !== false ||
    g.productionExcluded !== true
  ) stop('independent_execution_grant_absent');
}
function checkWatch(w, run, claim) {
  if (
    !sameRun(w, run) || w.status !== 'INDEPENDENT_WATCH_REGISTERED' ||
    w.claimCommentId !== claim.claimCommentId ||
    w.signedRegistrationReadBack !== true ||
    w.branchAbsentBeforeProvisioning !== true ||
    w.watchdogActivelyArmed !== true ||
    w.previewCleanupArmedVerified !== true
  ) stop('cleanup_watch_unverified');
}
function checkBranch(branch, run) {
  if (
    !sameRun(branch, run) ||
    !REF.test(branch.ref ?? '') ||
    branch.ref === PROD || branch.ref === SHARED ||
    branch.parentRef !== PROD ||
    branch.name !== 'community-phase2-hosted-' + run.runId ||
    branch.withData !== false
  ) stop('isolated_branch_identity_not_proven');
}
function checkPreview(p, run, branch) {
  let url;
  try {
    url = new URL(p?.url);
  } catch {
    stop('preview_origin_invalid');
  }
  if (
    !sameRun(p, run) || p.status !== 'PROTECTED_PREVIEW_VERIFIED' ||
    p.projectRef !== branch.ref ||
    p.deployedSha !== run.candidateSha ||
    p.vercelEnvironment !== 'preview' ||
    !DEPLOY_ID.test(p.deploymentId ?? '') ||
    p.teamId !== VERCEL_TEAM ||
    p.projectId !== VERCEL_PROJECT ||
    p.ref !== FEATURE_REF ||
    p.candidateSha !== run.candidateSha ||
    p.previewOrigin !== url.origin ||
    !url.hostname.endsWith('.vercel.app') ||
    url.protocol !== 'https:' ||
    url.username !== '' || url.password !== '' ||
    url.port !== '' ||
    url.hostname === 'novelrise.vercel.app' ||
    url.pathname !== '/' || url.search !== '' || url.hash !== ''
  ) stop('preview_binding_not_proven');
}
function checkReconciledPreview(p, run, branch) {
  // This receipt only permits cleanup of the one verified deployment.
  // Never continue the hosted test after an ambiguous Preview creation.
  if (
    !sameRun(p, run) ||
    !DEPLOY_ID.test(p?.deploymentId ?? '') ||
    p?.candidateSha !== run.candidateSha ||
    p?.projectRef !== branch.ref ||
    p?.teamId !== VERCEL_TEAM ||
    p?.projectId !== VERCEL_PROJECT ||
    p?.ref !== FEATURE_REF
  ) stop('preview_reconciliation_target_not_proven');
  let origin;
  try {
    origin = new URL(p.previewOrigin);
  } catch {
    stop('preview_reconciliation_origin_invalid');
  }
  if (
    origin.protocol !== 'https:' ||
    !origin.hostname.endsWith('.vercel.app') ||
    origin.hostname === 'novelrise.vercel.app' ||
    origin.username || origin.password || origin.port ||
    origin.pathname !== '/' || origin.search || origin.hash
  ) stop('preview_reconciliation_origin_unsafe');
}
function checkProof(proof, run, branch, preview) {
  if (
    !sameRun(proof, run) ||
    proof.status !== 'PHASE2_HOSTED_THREE_ROLE_PROOF' ||
    proof.projectRef !== branch.ref ||
    proof.previewUrl !== preview.url ||
    REQUIRED_PHASE2_BROWSER_PROOFS.some((name) => proof[name] !== true)
  ) stop('three_role_board_timeline_proof_incomplete');
}
function checkTerminal(t, run, claim, outcome) {
  if (
    !sameRun(t, run) || t.status !== 'ONE_USE_CONSUMPTION_RECORDED' ||
    t.claimCommentId !== claim.claimCommentId ||
    !ID.test(t.consumptionCommentId ?? '') ||
    t.outcome !== outcome
  ) stop('terminal_consumption_ambiguous');
}

// This is an interface for a *future* protected-main executor. Supplying a
// callback does not confer GitHub OWNER authority or permission to spend.
// Never attach untrusted PR-side adapters or use this as a grant factory.
export async function executePhase2JointHostedContract({ run, operations }) {
  validRun(run, operations);

  const boundary = await requireOperation(
    operations, 'freshOwnerLedgerAndCostBoundary'
  )(run);
  checkBoundary(boundary, run);

  // A claim's ambiguous failure is a terminal stop; NEVER issue another
  // claim for this same request automatically.
  let claim;
  try {
    claim = await operations.reserveAndRecordOneUseClaim(run, boundary);
  } catch {
    stop('ambiguous_claim_do_not_retry');
  }
  checkClaim(claim, run);

  let outcome = 'failure';
  let branch = null;
  let preview = null;
  let proof = null;
  let cleanupVerified = false;
  let failure = false;

  try {
    const grant = await operations.verifyIndependentProtectedGrant(
      run, claim, boundary
    );
    checkGrant(grant, run, claim);
    const watch = await operations.registerIndependentCleanupWatch(
      run, claim, grant
    );
    checkWatch(watch, run, claim);
    try {
      branch = await operations.createIsolatedBranch(run, grant, watch);
    } catch {
      // The POST may have succeeded even if its response was lost.
      // Reconcile once, never create again. A found branch is cleanup-only;
      // do not continue the hosted proof from an ambiguous creation.
      const reconciled = await operations.reconcileIsolatedBranch(
        run, grant, watch
      );
      if (reconciled?.status === 'BRANCH_FOUND_REQUIRES_CLEANUP') {
        branch = reconciled.created;
        checkBranch(branch, run);
      }
      stop('ambiguous_branch_creation_cleanup_only');
    }
    checkBranch(branch, run);
    const db = await operations.applyPinnedPhase2Schema(run, branch, grant);
    if (
      !sameRun(db, run) || db.status !== 'PHASE2_SCHEMA_APPLIED' ||
      db.projectRef !== branch.ref ||
      db.isolatedSchemaVerified !== true ||
      db.productionExcluded !== true ||
      db.publicEnabled !== false
    ) stop('isolated_schema_not_proven');
    // Provision only synthetic isolated identities, then require the real
    // author profile to age naturally past the DB anti-spam time limit.
    // Never bypass that rule or copy Production accounts into Staging.
    await operations.provisionIsolatedSyntheticAccounts(run, branch, grant);
    const fixtures = await operations.verifyIsolatedSyntheticAccounts(
      run, branch, grant
    );
    const fixtureVerdict = inspectPhase2SyntheticFixtureReadiness({
      run,
      branch,
      evidence: fixtures,
      nowMs: Date.now()
    });
    if (fixtureVerdict.status !==
      'PHASE2_HOSTED_FIXTURE_READINESS_ASSERTED') {
      stop('isolated_synthetic_accounts_not_ready');
    }
    // Only this fresh data-less branch may be opened for the isolated write
    // proof. Production and shared staging are excluded by checkBranch().
    const active = await operations.enableIsolatedCommunityForProof(
      run, branch, grant
    );
    if (
      !sameRun(active, run) ||
      active.status !== 'ISOLATED_COMMUNITY_TEST_GATE_ON' ||
      active.projectRef !== branch.ref ||
      active.publicEnabled !== true ||
      active.productionExcluded !== true
    ) stop('isolated_test_gate_activation_unverified');
    try {
      preview = await operations.createProtectedPreview(run, branch, grant);
    } catch {
      // The POST could have allocated a billable Vercel Preview. Reconcile
      // exactly once, retain the identity for cleanup, never redeploy.
      const recovery = await operations.reconcileProtectedPreview(
        run, branch, grant
      );
      if (recovery?.status === 'PREVIEW_FOUND_REQUIRES_CLEANUP') {
        checkReconciledPreview(recovery.preview, run, branch);
        preview = recovery.preview;
      }
      stop('ambiguous_preview_creation_cleanup_only');
    }
    const observed = await operations.verifyIsolatedPreviewBinding(
      run, branch, preview
    );
    checkPreview(observed, run, branch);
    preview = observed;
    proof = await operations.runThreeRoleHostedAcceptance(
      run, branch, preview
    );
    checkProof(proof, run, branch, preview);
    outcome = 'success';
  } catch {
    failure = true;
  } finally {
    // Never short circuit cleanup, even when browser or migration fails.
    let disabled;
    try {
      // Isolation gate must be OFF before branch destruction. If this fails,
      // cleanup continues but the result is NEVER marked successful.
      disabled = await operations.disableIsolatedCommunityAfterProof(
        run, branch
      );
    } catch {
      disabled = null;
    }
    // Wrap each adapter call in its own promise. Calling them while building
    // the array can throw synchronously and prevent the other deletion and
    // one-use terminal consumption from running at all.
    const removals = await Promise.allSettled([
      Promise.resolve().then(() =>
        operations.disposeProtectedPreview(run, preview)
      ),
      Promise.resolve().then(() =>
        operations.destroyIsolatedBranch(run, branch)
      )
    ]);
    let verification;
    try {
      // Read-back must run only AFTER both disposal attempts settle.
      verification = await operations.readBackCleanup(run, branch, preview);
    } catch {
      verification = null;
    }
    cleanupVerified =
      disabled?.status === 'ISOLATED_COMMUNITY_GATE_CONFIRMED_OFF' &&
      (branch === null || disabled?.projectRef === branch.ref) &&
      removals.every((entry) =>
        entry.status === 'fulfilled' &&
        entry.value?.status === 'CONFIRMED_CLEAN'
      ) && verification?.status === 'CONFIRMED_CLEAN';
    if (!cleanupVerified) {
      outcome = 'failure';
      failure = true;
    }
  }

  // Even after failed cleanup, consume exactly this request and retain
  // external cleanup-watch registration for independent recovery.
  let terminal;
  try {
    terminal = await operations.recordTerminalConsumption(
      run, claim, outcome
    );
  } catch {
    stop('consumption_uncertain_manual_reconcile');
  }
  checkTerminal(terminal, run, claim, outcome);

  if (failure || outcome !== 'success') {
    stop('execution_or_cleanup_incomplete_watchdog_required');
  }
  return Object.freeze({
    status: 'THREE_ROLE_PHASE2_VERIFIED_AND_ISOLATED_RESOURCES_REMOVED',
    mainSha: run.mainSha,
    candidateSha: run.candidateSha,
    projectRef: branch.ref,
    cleanupVerified,
    proofVerified: true,
    consumptionRecorded: true,
    productionMutationApproved: false,
    publicReleaseAuthorized: false
  });
}
