import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommunityHostedSingleLifecycle } from '../scripts/community-hosted-ordered-handoff.mjs';

const RUN = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  scope: 'community-phase1-hosted-authenticated-write',
  mainSha: 'a'.repeat(40),
  candidateSha: '91114a536688411caa37a5640a14eca01c8e0335',
  requestCommentId: '123',
  runId: '456'
});

function fixture(options = {}) {
  const calls = [];
  const ref = 'refs/tags/novelight-community-hosted-once-v1-123';
  const boundary = {
    ...RUN,
    status: 'FRESH_OWNER_PROTECTED_ENVIRONMENT_AND_BUDGET',
    ownerVerified: true,
    trustedMainVerified: true,
    tagProtectionVerified: true,
    exclusiveRunVerified: true,
    environmentProtectionVerified: true,
    oneUseStagingCostApproved: true,
    budgetBounded: true,
    cleanupPathVerified: true,
    ...options.boundary
  };
  const claim = {
    ...RUN,
    status: 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION',
    reservationRef: ref,
    claimCommentId: '124',
    uniqueRefObserved: true,
    executableGrantIssued: false,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false,
    ...options.claim
  };
  const grant = {
    ...RUN,
    status: 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW',
    stagingCostApproved: true,
    runAuthorized: true,
    writeAuthorized: true,
    productionMutationApproved: false,
    protectedEnvironmentVerified: true,
    exclusiveRunVerified: true,
    ...options.grant
  };
  const proof = {
    ...RUN,
    status: 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED',
    browserVerified: true,
    cleanupVerified: true,
    ...options.proof
  };
  const operations = {
    verifyFreshProtectedBoundary: async () => {
      calls.push('preflight');
      if (options.throwAt === 'preflight') throw Error('SECRET');
      return boundary;
    },
    reserveAndRecordClaim: async () => {
      calls.push('claim');
      if (options.throwAt === 'claim') throw Error('SECRET');
      return claim;
    },
    obtainIndependentExecutionGrant: async () => {
      calls.push('grant');
      if (options.throwAt === 'grant') throw Error('SECRET');
      return grant;
    },
    runIsolatedLifecycle: async () => {
      calls.push('isolated');
      if (options.throwAt === 'isolated') throw Error('SECRET');
      return proof;
    },
    recordTerminalConsumption: async ({ outcome, lifecycleProof }) => {
      calls.push('consume:' + outcome);
      if (options.throwAt === 'consume') throw Error('SECRET');
      assert.equal(lifecycleProof === null, outcome !== 'success');
      return {
        ...RUN,
        status: 'CONSUMPTION_RECORDED_NO_RUN_AUTHORIZATION',
        reservationRef: ref,
        claimCommentId: '124',
        consumeCommentId: '125',
        outcome,
        stagingCostApproved: false,
        runAuthorized: false,
        writeAuthorized: false,
        releaseAuthorized: false,
        executableGrantIssued: false,
        ...options.terminal
      };
    }
  };
  return { calls, operations };
}

test('exact single-run order: protected preflight, CLAIM, isolated, CONSUME', async () => {
  const x = fixture();
  const result = await runCommunityHostedSingleLifecycle({
    run: RUN,
    operations: x.operations
  });
  assert.deepEqual(x.calls, [
    'preflight',
    'claim',
    'grant',
    'isolated',
    'consume:success'
  ]);
  assert.equal(result.status, 'HOSTED_LIFECYCLE_ORDERED_AND_TERMINAL_RECORDED');
  assert.equal(result.executableGrantIssued, false);
  assert.ok(Object.isFrozen(result));
});

test('missing adapters and identity drift fail before any activity', async () => {
  const x = fixture();
  delete x.operations.recordTerminalConsumption;
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
    /DENIED/u
  );
  assert.deepEqual(x.calls, []);
  const y = fixture();
  await assert.rejects(
    runCommunityHostedSingleLifecycle({
      run: { ...RUN, candidateSha: 'b'.repeat(40) },
      operations: y.operations
    }),
    /DENIED/u
  );
  assert.deepEqual(y.calls, []);
});

test('missing cost, environment, exclusion or cleanup evidence prevents CLAIM', async () => {
  for (const field of [
    'oneUseStagingCostApproved',
    'environmentProtectionVerified',
    'exclusiveRunVerified',
    'cleanupPathVerified',
    'tagProtectionVerified'
  ]) {
    const x = fixture({ boundary: { [field]: false } });
    await assert.rejects(
      runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
      /DENIED/u
    );
    assert.deepEqual(x.calls, ['preflight']);
  }
});

test('ambiguous CLAIM never retries, opens resources or writes terminal', async () => {
  const x = fixture({ throwAt: 'claim' });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
    /claim outcome unknown/u
  );
  assert.deepEqual(x.calls, ['preflight', 'claim']);
});

test('CLAIM receipt tampering fails closed before Stage cost', async () => {
  const x = fixture({ claim: { requestCommentId: '321' } });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
    /claim receipt ambiguous/u
  );
  assert.deepEqual(x.calls, ['preflight', 'claim']);
});

test('grant failure records one terminal failure, never runs browser', async () => {
  const x = fixture({ grant: { productionMutationApproved: true } });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
    /terminal failure recorded/u
  );
  assert.deepEqual(x.calls, ['preflight', 'claim', 'grant', 'consume:failure']);
});

test('browser or cleanup failure must not be a success CONSUME', async () => {
  for (const options of [
    { throwAt: 'isolated' },
    { proof: { cleanupVerified: false } },
    { proof: { runId: '999' } }
  ]) {
    const x = fixture(options);
    await assert.rejects(
      runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
      /terminal failure recorded/u
    );
    assert.equal(x.calls.at(-1), 'consume:failure');
    assert.equal(x.calls.filter((s) => s === 'claim').length, 1);
  }
});

test('ambiguous CONSUME never retries or reports completion', async () => {
  const x = fixture({ throwAt: 'consume' });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
    (error) => {
      assert.match(error.message, /terminal outcome unknown/u);
      assert.doesNotMatch(error.message, /SECRET/u);
      return true;
    }
  );
  assert.equal(x.calls.filter((s) => s.startsWith('consume')).length, 1);
});

test('mismatched terminal receipt fails closed without a second POST', async () => {
  const x = fixture({ terminal: { runId: '999' } });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: RUN, operations: x.operations }),
    /terminal receipt ambiguous/u
  );
  assert.equal(x.calls.filter((s) => s.startsWith('consume')).length, 1);
});
