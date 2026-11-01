import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { create020705DetachedRecoveryOffline } from
  '../.github/staging-ai-02-07-05/detached-recovery-offline.mjs';

const NOW = Date.parse('2026-11-02T00:00:00Z');
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_synthetic123',
  actorId: '11111111-1111-4111-8111-111111111111',
  runId: 1001, approvalCommentId: 777, novelId: 41, episodeId: 11
});
const COUNTS = [
  'users', 'identities', 'sessions', 'profiles',
  'novels', 'episodes', 'facts', 'analysis',
  'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit'
];

// prettier-ignore
function fixture({dead = true, stale = false, broken = null, invalidCensus = false} = {}) {
  const actions = [];
  let consumed = false;
  const deathProof = {
    ...scope, kind: 'detached-controller-runner-death',
    runnerConfirmedDead: dead, controllerIsRunner: false,
    controllerRunId: 3001,
    observedAtMs: NOW - 10,
    runnerHeartbeatAtMs: NOW - (stale ? 16000 : 1000)
  };
  const mark = (name) => async () => {
    actions.push(name);
    if (broken === name) throw new Error('PRIVATE_RAW_ERROR_NEVER_LOG');
    return true;
  };
  const options = {
    mode: 'offline-synthetic-only',
    scope, now: () => NOW,
    readIndependentDeathProof: async () => deathProof,
    claimRecoveryOnce: async () => {
      actions.push('claim');
      if (consumed) return false;
      consumed = true;
      return true;
    },
    stopSyntheticModel: mark('model-stop'),
    stopSyntheticRuntime: mark('runtime-zero'),
    disableSyntheticPreview: mark('preview-disable'),
    revokeSyntheticSessions: mark('session-revoke'),
    cleanupSyntheticFixture: mark('cleanup'),
    independentZeroCensus: async () => {
      actions.push('independent-census');
      if (broken === 'independent-census') throw new Error('SENSITIVE_RAW_ERROR');
      return {
        runtimeDisabledZero: !invalidCensus,
        approvalTombstoneCount: 1,
        ...Object.fromEntries(COUNTS.map((name) => [name, 0]))
      };
    }
  };
  return {options, actions};
}

// prettier-ignore
test('independent synthetic recovery strictly orders stop, revoke, cleanup and census', async () => {
  const {options, actions} = fixture();
  const recovery = create020705DetachedRecoveryOffline(options);
  const out = await recovery.recover();
  assert.equal(out.status, 'SYNTHETIC_RECOVERY_VERIFIED');
  assert.equal(out.authorizesRealMutation, false);
  assert.deepEqual(actions, [
    'claim', 'model-stop', 'runtime-zero', 'preview-disable',
    'session-revoke', 'cleanup', 'independent-census'
  ]);
  await assert.rejects(recovery.recover(), /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
});

// prettier-ignore
test('healthy, stale, incorrect scope or untrusted caller cannot claim or stop', async () => {
  for (const kind of ['alive', 'stale', 'other-sha', 'wrong-mode']) {
    const {options, actions} = fixture({
      dead: kind !== 'alive', stale: kind === 'stale'
    });
    if (kind === 'other-sha') {
      options.readIndependentDeathProof = async () => ({
        ...scope, mainSha: 'b'.repeat(40),
        kind: 'detached-controller-runner-death',
        runnerConfirmedDead: true, controllerIsRunner: false,
        controllerRunId: 3001, observedAtMs: NOW - 10,
        runnerHeartbeatAtMs: NOW - 1000
      });
    }
    if (kind === 'wrong-mode') options.mode = 'staging-live';
    if (kind === 'wrong-mode') {
      assert.throws(() => create020705DetachedRecoveryOffline(options),
        /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
    } else {
      await assert.rejects(create020705DetachedRecoveryOffline(options).recover(),
        /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
    }
    assert.equal(actions.includes('claim'), false);
    assert.equal(actions.includes('model-stop'), false);
  }
});

// prettier-ignore
test('one stop failure still attempts all stop/revoke stages, denies cleanup and checks census', async () => {
  for (const broken of ['model-stop', 'runtime-zero', 'preview-disable', 'session-revoke']) {
    const {options, actions} = fixture({broken});
    await assert.rejects(create020705DetachedRecoveryOffline(options).recover(),
      /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
    assert.equal(actions.includes('model-stop'), true);
    assert.equal(actions.includes('runtime-zero'), true);
    assert.equal(actions.includes('preview-disable'), true);
    assert.equal(actions.includes('session-revoke'), true);
    assert.equal(actions.includes('cleanup'), false);
    assert.equal(actions.includes('independent-census'), true);
  }
});

// prettier-ignore
test('unknown or failed atomic consume denies all mutation, without retry', async () => {
  for (const kind of ['false', 'throws', 'not-boolean']) {
    const {options, actions} = fixture();
    options.claimRecoveryOnce = async () => {
      actions.push('claim');
      if (kind === 'throws') throw new Error('SENSITIVE_ERROR');
      return kind === 'not-boolean' ? {ok: true} : false;
    };
    const recovery = create020705DetachedRecoveryOffline(options);
    await assert.rejects(recovery.recover(),
      /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
    assert.deepEqual(actions, ['claim']);
    await assert.rejects(recovery.recover(),
      /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
  }
});

// prettier-ignore
test('cleanup or zero census failure consumes recovery and does not report success', async () => {
  for (const configuration of [{broken: 'cleanup'}, {invalidCensus: true},
    {broken: 'independent-census'}]) {
    const {options, actions} = fixture(configuration);
    await assert.rejects(create020705DetachedRecoveryOffline(options).recover(),
      /AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED/u);
    assert.equal(actions.includes('model-stop'), true);
    assert.equal(actions.includes('independent-census'), true);
  }
});
