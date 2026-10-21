// One-run ordering coordinator for Community Phase 1 hosted verification.
//
// This is NOT an OWNER authenticator, permission issuer, CI entrypoint, or
// external API adapter. It has no secrets, default adapters or CLI. A future
// independently audited protected-main runner must supply *all* capabilities.
// Never attach it to an issue_comment workflow before cost, environment,
// exclusion and cleanup evidence are proven and separately approved.
const REPO = 'bingohooah888-ai/novelrise';
const SCOPE = 'community-phase1-hosted-authenticated-write';
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;
const REQUIRED = Object.freeze([
  'verifyFreshProtectedBoundary',
  'reserveAndRecordClaim',
  'obtainIndependentExecutionGrant',
  'runIsolatedLifecycle',
  'recordTerminalConsumption'
]);

function deny(reason) {
  // Avoid returning raw adapter errors, GitHub payloads, bearer tokens,
  // comment bodies or external provider responses.
  throw new Error('COMMUNITY_HOSTED_HANDOFF_DENIED: ' + reason);
}

function sameRun(item, run) {
  return (
    item?.requestCommentId === run.requestCommentId &&
    item?.runId === run.runId
  );
}

function sameRevision(item, run) {
  return (
    item?.mainSha === run.mainSha &&
    item?.candidateSha === run.candidateSha
  );
}

function checkRun(run, operations) {
  if (
    run?.repository !== REPO ||
    run?.scope !== SCOPE ||
    !SHA.test(run?.mainSha ?? '') ||
    !SHA.test(run?.candidateSha ?? '') ||
    run.candidateSha === run.mainSha ||
    !ID.test(run.requestCommentId ?? '') ||
    !ID.test(run.runId ?? '') ||
    !operations ||
    REQUIRED.some((name) => typeof operations[name] !== 'function')
  ) {
    deny('scope, identity or mandatory adapters unavailable');
  }
}

function checkProtectedBoundary(boundary, run) {
  // These facts MUST originate from independent authenticated GitHub and
  // staging provider reads in the future trusted runner, never the comment.
  if (
    boundary?.status !== 'FRESH_OWNER_PROTECTED_ENVIRONMENT_AND_BUDGET' ||
    !sameRun(boundary, run) ||
    !sameRevision(boundary, run) ||
    boundary.ownerVerified !== true ||
    boundary.trustedMainVerified !== true ||
    boundary.tagProtectionVerified !== true ||
    boundary.exclusiveRunVerified !== true ||
    boundary.environmentProtectionVerified !== true ||
    boundary.oneUseStagingCostApproved !== true ||
    boundary.budgetBounded !== true ||
    boundary.cleanupPathVerified !== true
  ) {
    deny('authenticated pre-cost boundary not proven');
  }
}

function checkClaim(claim, run) {
  if (
    claim?.status !==
      'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION' ||
    !sameRun(claim, run) ||
    claim.reservationRef !==
      'refs/tags/novelight-community-hosted-once-v1-' +
        run.requestCommentId ||
    !ID.test(claim.claimCommentId ?? '') ||
    claim.uniqueRefObserved !== true ||
    claim.executableGrantIssued !== false ||
    claim.stagingCostApproved !== false ||
    claim.runAuthorized !== false ||
    claim.writeAuthorized !== false ||
    claim.releaseAuthorized !== false
  ) {
    deny('claim receipt ambiguous; reconcile manually, never retry');
  }
}

function checkIndependentGrant(grant, run) {
  // No grant is derived from the CLAIM receipt. A separately authenticated,
  // budget-limited and environment-protected executor must supply this.
  if (
    grant?.status !== 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW' ||
    grant.scope !== run.scope ||
    !sameRun(grant, run) ||
    !sameRevision(grant, run) ||
    grant.stagingCostApproved !== true ||
    grant.runAuthorized !== true ||
    grant.writeAuthorized !== true ||
    grant.productionMutationApproved !== false ||
    grant.protectedEnvironmentVerified !== true ||
    grant.exclusiveRunVerified !== true
  ) {
    deny('independent protected execution authorization absent');
  }
}

function checkLifecycle(proof, run) {
  return (
    proof?.status === 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED' &&
    proof.browserVerified === true &&
    proof.cleanupVerified === true &&
    sameRun(proof, run) &&
    sameRevision(proof, run)
  );
}

function checkTerminal(terminal, run, claim, outcome) {
  if (
    terminal?.status !== 'CONSUMPTION_RECORDED_NO_RUN_AUTHORIZATION' ||
    !sameRun(terminal, run) ||
    terminal.reservationRef !== claim.reservationRef ||
    terminal.claimCommentId !== claim.claimCommentId ||
    !ID.test(terminal.consumeCommentId ?? '') ||
    terminal.outcome !== outcome ||
    terminal.stagingCostApproved !== false ||
    terminal.runAuthorized !== false ||
    terminal.writeAuthorized !== false ||
    terminal.releaseAuthorized !== false ||
    terminal.executableGrantIssued !== false
  ) {
    deny('terminal receipt ambiguous; reconcile manually, never retry');
  }
}

// All calls must execute within one trusted protected runner. A failure before
// an exact CLAIM receipt is ambiguous: do NOT auto-retry or auto-consume.
// Once CLAIM is certain, record ONE terminal outcome even on grant or browser
// failure. "failure" never asserts cleanup succeeded. A failed/ambiguous
// terminal POST must not be retried; reconcile the ledger and resources.
export async function runCommunityHostedSingleLifecycle({ run, operations }) {
  checkRun(run, operations);

  let boundary;
  try {
    boundary = await operations.verifyFreshProtectedBoundary(run);
  } catch {
    deny('pre-cost evidence unavailable');
  }
  checkProtectedBoundary(boundary, run);

  let claim;
  try {
    claim = await operations.reserveAndRecordClaim(run);
  } catch {
    deny('claim outcome unknown; do not retry, reconcile manually');
  }
  checkClaim(claim, run);

  let outcome = 'failure';
  let lifecycleProof = null;
  try {
    const grant = await operations.obtainIndependentExecutionGrant(run, claim);
    checkIndependentGrant(grant, run);
    lifecycleProof = await operations.runIsolatedLifecycle(run, grant, claim);
    if (checkLifecycle(lifecycleProof, run)) {
      outcome = 'success';
    }
  } catch {
    // Never report a successful test from exceptions or incomplete cleanup.
    outcome = 'failure';
    lifecycleProof = null;
  }

  let terminal;
  try {
    terminal = await operations.recordTerminalConsumption({
      run,
      claim,
      outcome,
      lifecycleProof: outcome === 'success' ? lifecycleProof : null
    });
  } catch {
    deny('terminal outcome unknown; do not retry, reconcile manually');
  }
  checkTerminal(terminal, run, claim, outcome);

  if (outcome !== 'success') {
    deny('run failed or cleanup unproven; terminal failure recorded');
  }
  return Object.freeze({
    status: 'HOSTED_LIFECYCLE_ORDERED_AND_TERMINAL_RECORDED',
    mainSha: run.mainSha,
    candidateSha: run.candidateSha,
    requestCommentId: run.requestCommentId,
    runId: run.runId,
    claimCommentId: claim.claimCommentId,
    consumeCommentId: terminal.consumeCommentId,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false,
    executableGrantIssued: false
  });
}
