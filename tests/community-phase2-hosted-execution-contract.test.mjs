import assert from 'node:assert/strict';
import { URL } from 'node:url';
import test from 'node:test';
import * as lifecycle from '../scripts/community-phase2-hosted-execution-contract.mjs';
import * as readiness from '../scripts/community-phase2-synthetic-fixture-readiness.mjs';

const mainSha = 'f6028c77915ffce5f01149cd374d03a3c81dca8f';
const candidateSha = 'feb1d7728e4d8cef917df52355d873807eba5cc9';
const projectRef = 'abcdefghijklmnopqrst';
const url = 'https://community-phase2-preview.vercel.app/';

// prettier-ignore
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
      watchdogActivelyArmed: true,
      previewCleanupArmedVerified: true
    }),
    createIsolatedBranch: wrap('create_branch', {
      ...fields,
      ref: projectRef,
      parentRef: 'fiepaguycecrredwrcwx',
      name: 'community-phase2-hosted-' + run.runId,
      withData: false
    }),
    reconcileIsolatedBranch: wrap('reconcile_branch', {
      status: 'BRANCH_FOUND_REQUIRES_CLEANUP',
      created: {
        ...fields,
        ref: projectRef,
        parentRef: 'fiepaguycecrredwrcwx',
        name: 'community-phase2-hosted-' + run.runId,
        withData: false
      }
    }),
    applyPinnedPhase2Schema: wrap('apply_schema', {
      ...fields,
      status: 'PHASE2_SCHEMA_APPLIED',
      projectRef,
      isolatedSchemaVerified: true,
      productionExcluded: true,
      publicEnabled: false
    }),
    provisionIsolatedSyntheticAccounts: wrap('provision_users', {
      status: 'SYNTHETIC_ACCOUNTS_PROVISIONED'
    }),
    verifyIsolatedSyntheticAccounts: wrap('verify_users', {
      ...fields,
      projectRef,
      databaseUrl: 'https://' + projectRef + '.supabase.co',
      productionExcluded: true,
      accounts: {
        author: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'phase2-author@example.test',
          createdAt: '2026-10-23T00:00:00.000Z'
        },
        reader: {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'phase2-reader@example.test'
        },
        admin: {
          id: '33333333-3333-4333-8333-333333333333',
          email: 'phase2-admin@example.test'
        }
      },
      previewAdminEmailAllowlist: ['phase2-admin@example.test'],
      adminApiUsesIsolatedServiceRole: true,
      previewEnvironment: 'preview',
      stripeMode: 'test',
      isolatedPublishableKeyVerified: true,
      isolatedServerSecretVerified: true,
      hostedCredentialsScopedToBranch: true
    }),
    enableIsolatedCommunityForProof: wrap('enable_isolated_gate', {
      ...fields,
      status: 'ISOLATED_COMMUNITY_TEST_GATE_ON',
      projectRef,
      publicEnabled: true,
      productionExcluded: true
    }),
    createProtectedPreview: wrap('deploy_preview', {
      ...fields,
      status: 'PROTECTED_PREVIEW_VERIFIED',
      url,
      projectRef,
      deployedSha: candidateSha,
      vercelEnvironment: 'preview',
      deploymentId: 'dpl_123ABC456DEF',
      teamId: 'team_2XFgtRCPJQ6pbrEa4mOLQAEx',
      projectId: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
      ref: 'feat/community-plaza-board-phase2-20261023',
      candidateSha,
      previewOrigin: new URL(url).origin
    }),
    reconcileProtectedPreview: wrap('reconcile_preview', {
      status: 'PREVIEW_FOUND_REQUIRES_CLEANUP',
      preview: {
        ...fields,
        deploymentId: 'dpl_123ABC456DEF',
        teamId: 'team_2XFgtRCPJQ6pbrEa4mOLQAEx',
        projectId: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
        ref: 'feat/community-plaza-board-phase2-20261023',
        projectRef,
        previewOrigin: new URL(url).origin,
        candidateSha
      }
    }),
    verifyIsolatedPreviewBinding: wrap('verify_preview', {
      ...fields,
      status: 'PROTECTED_PREVIEW_VERIFIED',
      url,
      projectRef,
      deployedSha: candidateSha,
      vercelEnvironment: 'preview',
      deploymentId: 'dpl_123ABC456DEF',
      teamId: 'team_2XFgtRCPJQ6pbrEa4mOLQAEx',
      projectId: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
      ref: 'feat/community-plaza-board-phase2-20261023',
      candidateSha,
      previewOrigin: new URL(url).origin
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
    disableIsolatedCommunityAfterProof: wrap('disable_isolated_gate', {
      status: 'ISOLATED_COMMUNITY_GATE_CONFIRMED_OFF',
      projectRef
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
    'provision_users', 'verify_users', 'enable_isolated_gate',
    'deploy_preview', 'verify_preview', 'browser',
    'disable_isolated_gate', 'remove_preview', 'remove_branch',
    'check_cleanup', 'consume'
  ]);
  assert.equal(proof.publicReleaseAuthorized, false);
});

// prettier-ignore
test('missing grant blocks ALL hosted staging operations', async () => {
  const h = harness({ blockGrant: true });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.deepEqual(h.names, [
    'boundary', 'claim', 'grant', 'disable_isolated_gate',
    'remove_preview', 'remove_branch', 'check_cleanup', 'consume'
  ]);
});

// prettier-ignore
test('ambiguous creation reconciles once then cleans, never runs hosted proof', async () => {
  const h = harness({ failStep: 'create_branch' });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.ok(h.names.indexOf('create_branch') < h.names.indexOf('reconcile_branch'));
  assert.ok(!h.names.includes('apply_schema'));
  assert.ok(!h.names.includes('deploy_preview'));
  assert.ok(h.names.includes('remove_branch'));
  assert.equal(h.names.at(-1), 'consume');
});

// prettier-ignore
test('failed hosted browser still removes resources and consumes claim', async () => {
  const h = harness({ failStep: 'browser' });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.deepEqual(h.names.slice(-5),
    ['disable_isolated_gate', 'remove_preview', 'remove_branch',
      'check_cleanup', 'consume']);
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
// prettier-ignore
test('the database test gate opens only in the isolated branch and is closed before cleanup', async () => {
  const h = harness();
  await lifecycle.executePhase2JointHostedContract(h);
  assert.ok(h.names.indexOf('apply_schema') < h.names.indexOf('provision_users'));
  assert.ok(h.names.indexOf('verify_users') < h.names.indexOf('enable_isolated_gate'));
  assert.ok(h.names.indexOf('apply_schema') < h.names.indexOf('enable_isolated_gate'));
  assert.ok(h.names.indexOf('enable_isolated_gate') < h.names.indexOf('browser'));
  assert.ok(h.names.indexOf('browser') < h.names.indexOf('disable_isolated_gate'));
  assert.ok(h.names.indexOf('disable_isolated_gate') < h.names.indexOf('remove_branch'));
});

// prettier-ignore
test('missing isolated gate activation cannot access Preview', async () => {
  const h = harness({ failStep: 'enable_isolated_gate' });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.ok(!h.names.includes('deploy_preview'));
  assert.ok(h.names.includes('disable_isolated_gate'));
});

// prettier-ignore
test('author under ten minutes and missing admin allowlist block acceptance', () => {
  const run = {
    runId: '120123',
    candidateSha
  };
  const branch = { ref: projectRef };
  const base = {
    runId: '120123',
    candidateSha,
    projectRef,
    databaseUrl: 'https://' + projectRef + '.supabase.co',
    productionExcluded: true,
    accounts: {
      author: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'a@example.test',
        createdAt: '2026-10-23T12:00:00.000Z'
      },
      reader: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'r@example.test'
      },
      admin: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'z@example.test'
      }
    },
    previewAdminEmailAllowlist: [],
    adminApiUsesIsolatedServiceRole: true,
    previewEnvironment: 'preview',
    stripeMode: 'test',
    isolatedPublishableKeyVerified: true,
    isolatedServerSecretVerified: true,
    hostedCredentialsScopedToBranch: true
  };
  const actual = readiness.inspectPhase2SyntheticFixtureReadiness({
    run, branch, evidence: base,
    nowMs: Date.parse('2026-10-23T12:05:00.000Z')
  });
  assert.equal(actual.status, 'PHASE2_HOSTED_FIXTURE_NOT_READY');
  assert.ok(actual.errors.includes('AUTHOR_ACCOUNT_AGE_NOT_VERIFIED'));
  assert.ok(actual.errors.includes('SYNTHETIC_ADMIN_ALLOWLIST_NOT_ISOLATED'));
  assert.equal(actual.authorized, false);
});

// prettier-ignore
test('production or shared staging cannot pass synthetic fixture checks', () => {
  const run = { runId: '120123', candidateSha };
  for (const ref of [
    'fiepaguycecrredwrcwx',
    'wmlzjgvxgoyrovdhbqbg'
  ]) {
    const actual = readiness.inspectPhase2SyntheticFixtureReadiness({
      run, branch: { ref }, evidence: {},
      nowMs: Date.now()
    });
    assert.ok(actual.errors.includes('ISOLATED_BRANCH_UNVERIFIED'));
    assert.equal(actual.mayRunBrowser, false);
  }
});

// prettier-ignore
test('a fixture read failure never activates the isolated DB gate', async () => {
  const h = harness({ failStep: 'verify_users' });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.ok(!h.names.includes('enable_isolated_gate'));
  assert.ok(h.names.includes('disable_isolated_gate'));
});

// prettier-ignore
test('ambiguous Preview POST reconciles exact deployment, cleans it and never browses', async () => {
  const h = harness({ failStep: 'deploy_preview' });
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.equal(h.names.filter((name) => name === 'deploy_preview').length, 1);
  assert.ok(h.names.indexOf('deploy_preview') < h.names.indexOf('reconcile_preview'));
  assert.ok(!h.names.includes('verify_preview'));
  assert.ok(!h.names.includes('browser'));
  assert.ok(h.names.includes('remove_preview'));
  assert.equal(h.names.at(-1), 'consume');
});

// prettier-ignore
test('sync Preview deletion failure still attempts DB cleanup and records failure', async () => {
  const h = harness();
  const seen = [];
  h.operations.disposeProtectedPreview = () => {
    h.names.push('sync_throw_preview');
    throw new Error('synchronous Preview adapter error');
  };
  h.operations.recordTerminalConsumption = async (run, claim, outcome) => {
    h.names.push('consume');
    seen.push(outcome);
    return {
      runId: run.runId,
      requestCommentId: run.requestCommentId,
      mainSha: run.mainSha,
      candidateSha: run.candidateSha,
      claimCommentId: claim.claimCommentId,
      status: 'ONE_USE_CONSUMPTION_RECORDED',
      consumptionCommentId: '5123',
      outcome
    };
  };
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.ok(h.names.includes('remove_branch'));
  assert.ok(h.names.includes('check_cleanup'));
  assert.equal(h.names.at(-1), 'consume');
  assert.deepEqual(seen, ['failure']);
});

// prettier-ignore
test('sync branch deletion failure still attempts Preview cleanup and records failure', async () => {
  const h = harness();
  const seen = [];
  h.operations.destroyIsolatedBranch = () => {
    h.names.push('sync_throw_branch');
    throw new Error('synchronous Supabase adapter error');
  };
  h.operations.recordTerminalConsumption = async (run, claim, outcome) => {
    h.names.push('consume');
    seen.push(outcome);
    return {
      runId: run.runId,
      requestCommentId: run.requestCommentId,
      mainSha: run.mainSha,
      candidateSha: run.candidateSha,
      claimCommentId: claim.claimCommentId,
      status: 'ONE_USE_CONSUMPTION_RECORDED',
      consumptionCommentId: '5123',
      outcome
    };
  };
  await assert.rejects(lifecycle.executePhase2JointHostedContract(h),
    /execution_or_cleanup_incomplete/);
  assert.ok(h.names.includes('remove_preview'));
  assert.ok(h.names.includes('check_cleanup'));
  assert.equal(h.names.at(-1), 'consume');
  assert.deepEqual(seen, ['failure']);
});
