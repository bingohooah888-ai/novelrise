import assert from 'node:assert/strict';
import test from 'node:test';
import * as lifecycle from '../scripts/community-phase2-hosted-execution-contract.mjs';

const mainSha = 'f6028c77915ffce5f01149cd374d03a3c81dca8f';
const candidateSha = 'feb1d7728e4d8cef917df52355d873807eba5cc9';
const projectRef = 'abcdefghijklmnopqrst';
const url = 'https://community-phase2-preview.vercel.app/';

function harness({
  failStep = '',
  failCleanup = false,
  untrustedScope = false,
  blockGrant = false
} = {}) {
  const run = {
    repository: 'bingohooah888-ai/novelrise',
    scope: untrustedScope ? 'community-phase1-hosted-authenticated-write' :
      lifecycle.PHASE2_HOSTED_SCOPE,
    runId: '120123',
    requestCommentId: '4156',
    mainSha,
    candidateSha
  };
  const fields = {
    runId: run.runId,
    requestCommentId: run.requestCommentId,
    mainSha,
    candidateSha
  };
  const names = [];
  const wrap = (name, output) => async () => {
    names.push(name);
    if (failStep === name) throw new Error('simulated failure');
    return output;
  };
  const clean = () => (
    failCleanup ? { status: 'UNCERTAIN_CLEANUP' } :
      { status: 'CONFIRMED_CLEAN' }
  );
  const operations = {
    freshOwnerLedgerAndCostBoundary: wrap('boundary', {
      ...fields,
      status: 'PROTECTED_OWNER_BOUNDARY',
      ownerVerified: true,
      ledgerOpenVerified: true,
      approvalUnusedVerified: true,
      mainFreshVerified: true,
      candidatePinnedVerified: true,
      protectedEnvironmentVerified: true,
      oneUseBudgetCapEnforced: true,
      productionExcluded: true,
      independentCleanupReady: true
    }),
    reserveAndRecordOneUseClaim: wrap('claim', {
      ...fields,
      status: 'ONE_USE_CLAIM_RECORDED',
      claimCommentId: '4999',
      uniqueReservationVerified: true,
      consumedBefore: false
    }),
    verifyIndependentProtectedGrant: wrap('grant', {
      ...fields,
      status: 'INDEPENDENT_PROTECTED_EXECUTION_GRANT',
      claimCommentId: '4999',
      scope: run.scope,
      stagingCostApproved: !blockGrant,
      runAuthorized: !blockGrant,
      writeAuthorized: true,
      oneUseBudgetCapEnforced: true,
      protectedEnvironmentVerified: true,
      productionExcluded: true,
      productionMutationApproved: false
    }),
    registerIndependentCleanupWatch: wrap('watch', {
      ...fields,
      status: 'INDEPENDENT_WATCH_REGISTERED',
      claimCommentId: '4999',
      signedRegistrationReadBack: true,
      branchAbsentBeforeProvisioning: true,
      watchdogActivelyArmed: true
    }),
    createIsolatedBranch: wrap('create_branch', {
      ...fields,
      ref: projectRef,
      parentRef: 'fiepaguycecrredwrcwx',
      name: 'community-phase2-hosted-' + run.runId,
      withData: false
    }),
    reconcileIsolatedBranch: wrap('reconcile_branch', {
      ...fields,
      ref: projectRef,
      parentRef: 'fiepaguycecrredwrcwx',
      name: 'community-phase2-hosted-' + run.runId,
      withData: false
    }),
    applyPinnedPhase2Schema: wrap('apply_schema', {
      ...fields,
      status: 'PHASE2_SCHEMA_APPLIED',
      projectRef,
      isolatedSchemaVerified: true,
      productionExcluded: true,
      publicEnabled: false
    }),
    createProtectedPreview: wrap('deploy_preview', {
      ...fields,
      status: 'PROTECTED_PREVIEW_VERIFIED',
      url,
      projectRef,
      deployedSha: candidateSha,
      vercelEnvironment: 'preview'
    }),
    verifyIsolatedPreviewBinding: wrap('verify_preview', {
      ...fields,
      status: 'PROTECTED_PREVIEW_VERIFIED',
      url,
      projectRef,
      deployedSha: candidateSha,
      vercelEnvironment: 'preview'
    }),
    runThreeRoleHostedAcceptance: wrap('browser', {
      ...fields,
      status: 'PHASE2_HOSTED_THREE_ROLE_PROOF',
      previewUrl: url,
      projectRef,
      ...Object.fromEntries(
        lifecycle.REQUIRED_PHASE2_BROWSER_PROOFS.map((key) => [key, true])
      )
    }),
    disposeProtectedPreview: wrap('remove_preview', clean()),
    destroyIsolatedBranch: wrap('remove_branch', clean()),
    readBackCleanup: wrap('check_cleanup', clean()),
    recordTerminalConsumption: wrap('consume', {
      ...fields,
      status: 'ONE_USE_CONSUMPTION_RECORDED',
      claimCommentId: '4999',
      consumptionCommentId: '5123',
      outcome: 'success'
    })
  };
  if (failStep || failCleanup || blockGrant) {
    operations.recordTerminalConsumption = async (r, c, outcome) => {
      names.push('consume');
      return {
        ...fields,
        status: 'ONE_USE_CONSUMPTION_RECORDED',
        claimCommentId: '4999',
        consumptionCommentId: '5123',
        outcome
      };
    };
  }
  return { run, operations, names };
}

// prettier-ignore
test('success path executes exact one-use ordering and cleanup', async () => {
  const h = harness();
  const proof = await lifecycle.executePhase2JointHostedContract(h);
  assert.equal(proof.status,
    'THREE_ROLE_PHASE2_VERIFIED_AND_ISOLATED_RESOURCES_REMOVED');
  assert.deepEqual(h.names, [
    'boundary', 'claim', 'grant', 'watch', 'create_branch', 'apply_schema',
    'deploy_preview', 'verify_preview', 'browser',
    'remove_preview', 'remove_branch', 'check_cleanup', 'consume'
  ]);
  assert.equal(proof.publicReleaseAuthorized, false);
});

// prettier-ignore
test('missing grant blocks ALL hosted staging operations', async () => {
  const h = harness({ blockGrant: true });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.deepEqual(h.names, [
    'boundary', 'claim', 'grant', 'remove_preview', 'remove_branch',
    'check_cleanup', 'consume'
  ]);
});

// prettier-ignore
test('failed provisioning reconciles the branch before continuing', async () => {
  const h = harness({ failStep: 'create_branch' });
  await lifecycle.executePhase2JointHostedContract(h);
  assert.ok(h.names.indexOf('create_branch') < h.names.indexOf('reconcile_branch'));
  assert.ok(h.names.indexOf('reconcile_branch') < h.names.indexOf('apply_schema'));
});

// prettier-ignore
test('failed hosted browser still removes resources and consumes claim', async () => {
  const h = harness({ failStep: 'browser' });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.deepEqual(h.names.slice(-4),
    ['remove_preview', 'remove_branch', 'check_cleanup', 'consume']);
});

// prettier-ignore
test('cleanup failure cannot claim a valid hosted proof', async () => {
  const h = harness({ failCleanup: true });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.equal(h.names.at(-1), 'consume');
});

// prettier-ignore
test('Phase 1 scope cannot invoke Phase 2 hosting', async () => {
  const h = harness({ untrustedScope: true });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /untrusted_run_or_missing_adapter/);
  assert.equal(h.names.length, 0);
});

// prettier-ignore
test('missing adapter fails before even inspecting the approval ledger', async () => {
  const h = harness();
  delete h.operations.destroyIsolatedBranch;
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /untrusted_run_or_missing_adapter/);
  assert.equal(h.names.length, 0);
});
