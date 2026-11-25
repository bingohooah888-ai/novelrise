import assert from 'node:assert/strict';
import test from 'node:test';

// prettier-ignore
import { create020705UnpaidGateABCSequence } from '../.github/staging-ai-02-07-05/comprehensive-staging-sequence.mjs';

const DENIED = /AI_020705_STAGING_SEQUENCE_DENIED/u;

// prettier-ignore
function fixture() {
  const actions = [];
  const scope = {
    repository: 'bingohooah888-ai/novelrise',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
    supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    protectedEnvironment: 'staging', trustedRef: 'refs/heads/main',
    prNumber: 2895, mainSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40),
    stagingBranch: 'staging/ai-02-07-05-offline-proof',
    previewDeploymentId: 'dpl_offlineproof', approvalCommentId: 701, runId: 702,
    actorId: '11111111-1111-4111-8111-111111111111',
    novelId: 998892071, episodeId: 998892072,
    maxMigrations: 0, maxPreviews: 0, existingMigrationsOnly: true,
    existingPreviewOnly: true, maxPaidCalls: 0, capMicros: 0
  };
  const record = (name) => async () => { actions.push(name); return true; };
  const options = {
    scope,
    verifyOwnerAndRefs: record('owner'),
    verifyIndependentGateA: record('gate-a'),
    verifyStagingIsolation: record('isolation'),
    inspectInstalled: record('migration-read'),
    async preparePreview() {
      actions.push('preview-read');
      return {
        id: scope.previewDeploymentId, target: 'preview', ready: true,
        gitCommitSha: scope.candidateSha, gitBranch: scope.stagingBranch,
        supabaseUrl: scope.supabaseUrl, projectRef: scope.stagingProjectRef,
        ssoProtected: true
      };
    },
    beforeSynthetic: record('unpaid-admission'),
    async runSyntheticJwtProof() {
      actions.push('jwt');
      return {
        verifiedSynthetic: true, realSignedJwt: true, ownerOnly: true,
        rlsDeniedOtherActor: true, revokedSessionDenied: true,
        casConflictDenied: true, claimOnceDeniedReplay: true,
        stagingProjectRef: scope.stagingProjectRef, candidateSha: scope.candidateSha,
        actorId: scope.actorId, novelId: scope.novelId, episodeId: scope.episodeId
      };
    },
    stopAndCleanup: record('stop-cleanup'),
    independentFinalCensus: record('census')
  };
  return { options, actions };
}

// prettier-ignore
test('unpaid composition cannot reach paid callbacks and cleans up on success', async () => {
  const { options, actions } = fixture();
  options.protectedPaidFactory = () => { throw new Error('must not run'); };
  options.getProtectedPaidConfig = () => { throw new Error('must not run'); };
  const sequence = create020705UnpaidGateABCSequence(options);
  const result = await sequence.run();
  assert.equal(result.outcome, 'UNPAID_ABC_SEQUENCE_CONTRACT_VERIFIED');
  assert.equal(result.paidAttempts, 0);
  assert.equal(result.authorizesPaidCall, false);
  assert.equal(result.authorizesStagingWrite, false);
  assert.equal(result.authorizesPreviewCreation, false);
  assert.deepEqual(actions, ['owner', 'gate-a', 'isolation', 'migration-read',
    'preview-read', 'owner', 'gate-a', 'unpaid-admission', 'jwt', 'owner',
    'stop-cleanup', 'census']);
  await assert.rejects(sequence.run(), DENIED);
});

// prettier-ignore
test('Gate A NO-GO, lost Gate A proof, or denied admission cannot reach JWT', async () => {
  for (const failAt of ['initial', 'recheck', 'admission']) {
    const { options, actions } = fixture();
    let observed = 0;
    if (failAt === 'admission') options.beforeSynthetic = async () => false;
    else options.verifyIndependentGateA = async () =>
      failAt === 'recheck' && ++observed === 1;
    await assert.rejects(create020705UnpaidGateABCSequence(options).run(), DENIED);
    assert.equal(actions.includes('jwt'), false);
    assert.equal(actions.includes('stop-cleanup'), false);
    if (failAt === 'initial') assert.equal(actions.includes('preview-read'), false);
  }
});

// prettier-ignore
test('paid, migration, deployment, Production or incomplete scope is rejected', () => {
  for (const patch of [{ maxPaidCalls: 1 }, { capMicros: 1 }, { maxMigrations: 2 },
    { maxPreviews: 1 }, { existingPreviewOnly: false },
    { stagingProjectRef: 'fiepaguycecrredwrcwx' }, { actorId: '' }]) {
    const { options } = fixture();
    assert.throws(() => create020705UnpaidGateABCSequence({
      ...options, scope: { ...options.scope, ...patch }
    }), DENIED);
  }
});

// prettier-ignore
test('wrong Preview or wrong synthetic identity fails closed', async () => {
  const first = fixture();
  first.options.preparePreview = async () => ({ id: 'dpl_wrong' });
  await assert.rejects(create020705UnpaidGateABCSequence(first.options).run(), DENIED);
  assert.equal(first.actions.includes('jwt'), false);
  const second = fixture();
  const proof = second.options.runSyntheticJwtProof;
  second.options.runSyntheticJwtProof = async () => ({
    ...await proof(), novelId: 1
  });
  await assert.rejects(create020705UnpaidGateABCSequence(second.options).run(), DENIED);
  assert.deepEqual(second.actions.slice(-2), ['stop-cleanup', 'census']);
});

// prettier-ignore
test('JWT, cleanup or census failure never reports PASS and still attempts census', async () => {
  for (const key of ['runSyntheticJwtProof', 'stopAndCleanup', 'independentFinalCensus']) {
    const { options, actions } = fixture();
    options[key] = async () => { actions.push(key); throw new Error('private detail'); };
    await assert.rejects(create020705UnpaidGateABCSequence(options).run(), DENIED);
    if (key !== 'independentFinalCensus') assert.equal(actions.includes('census'), true);
    else assert.equal(actions.includes(key), true);
  }
});
