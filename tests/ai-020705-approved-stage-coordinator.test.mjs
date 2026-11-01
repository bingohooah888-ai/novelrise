// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import { coordinate020705ProtectedStagingTrial } from
  '../.github/staging-ai-02-07-05/approved-stage-coordinator.mjs';
// prettier-ignore
import { createPaidTrialOneShotOpenAiProvider } from
  '../api/_lib/ai/paid-trial-one-shot-provider.js';

// prettier-ignore
const NOW = Date.parse('2026-11-01T08:00:00Z');
// prettier-ignore
const SHA = 'a'.repeat(40);
// prettier-ignore
const OWNER = '11111111-1111-4111-8111-111111111111';
// prettier-ignore
const PREVIEW = 'dpl_synthetic123';
// prettier-ignore
const COMMENT_ID = 701;

// prettier-ignore
function setup({ fail = false, census = true } = {}) {
  const actions = [];
  const comments = [{
    id: COMMENT_ID,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body: 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
      JSON.stringify({
        actorId: OWNER,
        approvalScope: 'synthetic-one-provider-one-call-only',
        capMicros: 10000000,
        confirmation: 'STAGING PAID 1 CALL APPROVED',
        consentRevision: 'test-policy-v1',
        episodeId: 11,
        expiresAt: new Date(NOW + 3600000).toISOString(),
        mainSha: SHA,
        model: 'gpt-5.6-luna',
        novelId: 41,
        previewDeploymentId: PREVIEW,
        provider: 'openai',
        stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
      })
  }];
  let providerCalls = 0;
  let consumed = false;
  const guardedProvider = createPaidTrialOneShotOpenAiProvider({
    now: () => NOW,
    serviceClient: {
      supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      async rpc() {
        actions.push('db-claim');
        if (consumed) return { data: false, error: null };
        consumed = true;
        return { data: true, error: null };
      }
    },
    underlyingProvider: {
      async generate() {
        actions.push('provider');
        providerCalls += 1;
        if (fail) throw new Error('offline simulated timeout');
        return { text: '{"suggestions":[]}' };
      }
    },
    approved: {
      commentId: COMMENT_ID,
      ownerId: OWNER,
      novelId: 41,
      episodeId: 11,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      routeCount: 1,
      maxProviderCalls: 1,
      noRetry: true,
      fallbackDisabled: true,
      capMicros: 10000000,
      mainSha: SHA,
      previewDeploymentId: PREVIEW,
      expiresAt: new Date(NOW + 3600000).toISOString(),
      ownerLedgerClaimed: true,
      exactScopeVerified: true
    },
    deployment: {
      projectRef: 'wmlzjgvxgoyrovdhbqbg',
      supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      ready: true, isProduction: false, sha: SHA, id: PREVIEW
    }
  });
  const inputs = {
    approvalCommentId: COMMENT_ID,
    runId: 1001,
    now: () => NOW,
    expected: {
      mainSha: SHA,
      previewDeploymentId: PREVIEW,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      capMicros: 10000000,
      actorId: OWNER,
      novelId: 41,
      episodeId: 11,
      stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
    },
    readComments: async () => comments,
    async writeComment(body) {
      actions.push(body.includes('_CLAIMED ') ? 'github-claim' : 'github-consumed');
      comments.push({
        id: comments.length + 901,
        user: { login: 'github-actions[bot]' },
        body
      });
    },
    guardedProvider,
    request: { model: 'gpt-5.6-luna', system: 'synthetic', user: 'fiction' },
    stop: async () => { actions.push('stop'); return true; },
    cleanup: async () => { actions.push('cleanup'); return true; },
    finalCensus: async () => { actions.push('census'); return census; }
  };
  return { inputs, actions, calls: () => providerCalls };
}

// prettier-ignore
test('the OWNER claim, DB claim and one provider attempt precede cleanup', async () => {
  const { inputs, actions, calls } = setup();
  const result = await coordinate020705ProtectedStagingTrial(inputs);
  assert.equal(result.outcome, 'one_call_succeeded_and_cleanup_verified');
  assert.deepEqual(actions, [
    'github-claim', 'db-claim', 'provider',
    'stop', 'cleanup', 'census', 'github-consumed'
  ]);
  assert.equal(calls(), 1);
  await assert.rejects(
    coordinate020705ProtectedStagingTrial(inputs),
    /AI_020705_OWNER_LEDGER_DENIED/u
  );
  assert.equal(calls(), 1);
});

// prettier-ignore
test('timeout is consumed, never retried, and still performs cleanup', async () => {
  const { inputs, actions, calls } = setup({ fail: true });
  await assert.rejects(
    coordinate020705ProtectedStagingTrial(inputs),
    /AI_020705_PAID_ATTEMPT_FAILED_NO_RETRY/u
  );
  assert.equal(calls(), 1);
  assert.deepEqual(actions, [
    'github-claim', 'db-claim', 'provider',
    'stop', 'cleanup', 'census', 'github-consumed'
  ]);
});

// prettier-ignore
test('zero-census failure remains fatal even after one successful model call', async () => {
  const { inputs, actions, calls } = setup({ census: false });
  await assert.rejects(
    coordinate020705ProtectedStagingTrial(inputs),
    /AI_020705_PAID_CLEANUP_UNVERIFIED/u
  );
  assert.equal(calls(), 1);
  assert.equal(actions.at(-1), 'github-consumed');
});
