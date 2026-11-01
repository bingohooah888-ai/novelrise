import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claim020705OwnerApproval,
  consume020705OwnerApproval,
  inspect020705OwnerLedger
} from '../.github/staging-ai-02-07-05/owner-paid-trial-ledger.mjs';
import { run020705SinglePaidTrial } from '../.github/staging-ai-02-07-05/paid-trial-cleanup-runner.mjs';
import { createPaidTrialOneShotOpenAiProvider } from '../api/_lib/ai/paid-trial-one-shot-provider.js';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const OWNER = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(40);
// prettier-ignore
const approvalBody = {
  actorId: OWNER,
  approvalScope: 'synthetic-one-provider-one-call-only',
  capMicros: 2528640,
  confirmation: 'STAGING PAID 1 CALL APPROVED',
  consentRevision: 'test-policy-v1',
  episodeId: 11,
  expiresAt: new Date(NOW + 3600000).toISOString(),
  mainSha: SHA,
  model: 'gpt-5.6-luna',
  novelId: 41,
  previewDeploymentId: 'dpl_test123',
  provider: 'openai',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};
// prettier-ignore
const approval = {
  id: 777,
  user: { login: 'bingohooah888-ai' },
  author_association: 'OWNER',
  body:
    'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
    JSON.stringify(approvalBody)
};
// prettier-ignore
const expected = {
  mainSha: SHA,
  previewDeploymentId: 'dpl_test123',
  provider: 'openai',
  model: 'gpt-5.6-luna',
  capMicros: 2528640,
  actorId: OWNER,
  novelId: 41,
  episodeId: 11,
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};

// prettier-ignore
function ledger() {
  const comments = [structuredClone(approval)];
  return {
    comments,
    readComments: async () => comments,
    async writeComment(body) {
      comments.push({
        id: comments.length + 780,
        user: { login: 'github-actions[bot]' },
        body
      });
    }
  };
}

// prettier-ignore
function runtime({ failModel = false } = {}) {
  const log = [];
  let providerCalls = 0;
  let claimed = false;
  const guardedProvider = createPaidTrialOneShotOpenAiProvider({
    approved: {
      commentId: 777,
      ownerId: OWNER,
      novelId: 41,
      episodeId: 11,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      routeCount: 1,
      maxProviderCalls: 1,
      noRetry: true,
      fallbackDisabled: true,
      capMicros: 2528640,
      mainSha: SHA,
      previewDeploymentId: 'dpl_test123',
      expiresAt: approvalBody.expiresAt,
      ownerLedgerClaimed: true,
      exactScopeVerified: true
    },
    deployment: {
      id: 'dpl_test123',
      sha: SHA,
      projectRef: 'wmlzjgvxgoyrovdhbqbg',
      supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      ready: true,
      isProduction: false
    },
    now: () => NOW,
    serviceClient: {
      supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      async rpc() {
        log.push('claim');
        if (claimed) return { data: false };
        claimed = true;
        return { data: true };
      }
    },
    underlyingProvider: {
      async generate() {
        log.push('provider');
        providerCalls += 1;
        if (failModel) throw new Error('synthetic failure');
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  return { log, guardedProvider, count: () => providerCalls };
}

// prettier-ignore
test('OWNER claimed once, replay and consumed comments rejected', async () => {
  const state = ledger();
  const result = await claim020705OwnerApproval({
    ...state,
    approvalCommentId: 777,
    expected,
    runId: 1001,
    now: () => NOW
  });
  assert.equal(result.ownerLedgerClaimed, true);
  assert.equal(result.authorizesPaidCall, false);
  await assert.rejects(
    claim020705OwnerApproval({
      ...state,
      approvalCommentId: 777,
      expected,
      runId: 1002,
      now: () => NOW
    }),
    /AI_020705_OWNER_LEDGER_DENIED/u
  );
  await consume020705OwnerApproval({
    writeComment: state.writeComment,
    approvalCommentId: 777,
    runId: 1001,
    result: 'failure'
  });
  assert.equal(state.comments.length, 3);
  assert.throws(
    () =>
      inspect020705OwnerLedger({
        comments: state.comments,
        approvalCommentId: 777,
        expected,
        now: NOW
      }),
    /AI_020705_OWNER_LEDGER_DENIED/u
  );
});

// prettier-ignore
test('non-owner, wrong SHA and expired scopes are never claimable', () => {
  for (const changed of [
    { user: { login: 'stranger' } },
    { author_association: 'NONE' },
    {
      body:
        'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
        JSON.stringify({ ...approvalBody, mainSha: 'b'.repeat(40) })
    },
    {
      body:
        'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
        JSON.stringify({
          ...approvalBody,
          expiresAt: new Date(NOW).toISOString()
        })
    }
  ]) {
    assert.throws(
      () =>
        inspect020705OwnerLedger({
          comments: [{ ...approval, ...changed }],
          approvalCommentId: 777,
          expected,
          now: NOW
        }),
      /AI_020705_OWNER_LEDGER_DENIED/u
    );
  }
});

// prettier-ignore
test('runner requires a claimed ledger and a real one-shot guarded provider', async () => {
  const state = runtime();
  await assert.rejects(
    run020705SinglePaidTrial({
      claimed: { ownerLedgerClaimed: false, authorizesPaidCall: false },
      guardedProvider: state.guardedProvider,
      request: { model: 'gpt-5.6-luna', system: 's', user: 'u' },
      stop: async () => true,
      cleanup: async () => true,
      finalCensus: async () => true
    }),
    /AI_020705_PAID_RUNNER_DENIED/u
  );
  await assert.rejects(
    run020705SinglePaidTrial({
      claimed: { ownerLedgerClaimed: true, authorizesPaidCall: false },
      guardedProvider: { async generate() { throw new Error('bypass'); } },
      request: { model: 'gpt-5.6-luna', system: 's', user: 'u' },
      stop: async () => true,
      cleanup: async () => true,
      finalCensus: async () => true
    }),
    /AI_020705_PAID_RUNNER_DENIED/u
  );
  assert.equal(state.count(), 0);
});

// prettier-ignore
test('the only model attempt is always followed by stop, cleanup, census', async () => {
  const state = runtime();
  const response = await run020705SinglePaidTrial({
    claimed: { ownerLedgerClaimed: true, authorizesPaidCall: false },
    guardedProvider: state.guardedProvider,
    request: { model: 'gpt-5.6-luna', system: 's', user: 'u' },
    stop: async () => { state.log.push('stop'); return true; },
    cleanup: async () => { state.log.push('cleanup'); return true; },
    finalCensus: async () => { state.log.push('census'); return true; }
  });
  assert.equal(response.outcome, 'one_call_succeeded_and_cleanup_verified');
  assert.equal(state.count(), 1);
  assert.deepEqual(state.log, [
    'claim', 'provider', 'stop', 'cleanup', 'census'
  ]);
  assert.ok(!JSON.stringify(response).includes('"suggestions"'));
});

// prettier-ignore
test('provider error never retries but still stops and cleans', async () => {
  const state = runtime({ failModel: true });
  await assert.rejects(
    run020705SinglePaidTrial({
      claimed: { ownerLedgerClaimed: true, authorizesPaidCall: false },
      guardedProvider: state.guardedProvider,
      request: { model: 'gpt-5.6-luna', system: 's', user: 'u' },
      stop: async () => { state.log.push('stop'); return true; },
      cleanup: async () => { state.log.push('cleanup'); return true; },
      finalCensus: async () => { state.log.push('census'); return true; }
    }),
    /AI_020705_PAID_ATTEMPT_FAILED_NO_RETRY/u
  );
  assert.equal(state.count(), 1);
  assert.deepEqual(state.log, [
    'claim', 'provider', 'stop', 'cleanup', 'census'
  ]);
});

// prettier-ignore
test('failed stop cannot skip cleanup or census; final result stays failure', async () => {
  const state = runtime();
  await assert.rejects(
    run020705SinglePaidTrial({
      claimed: { ownerLedgerClaimed: true, authorizesPaidCall: false },
      guardedProvider: state.guardedProvider,
      request: { model: 'gpt-5.6-luna', system: 's', user: 'u' },
      stop: async () => { state.log.push('stop'); throw new Error('offline'); },
      cleanup: async () => { state.log.push('cleanup'); return false; },
      finalCensus: async () => { state.log.push('census'); return true; }
    }),
    /AI_020705_PAID_CLEANUP_UNVERIFIED/u
  );
  assert.deepEqual(state.log, [
    'claim', 'provider', 'stop', 'cleanup', 'census'
  ]);
});
