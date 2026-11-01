import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createPaidTrialOneShotOpenAiProvider,
  isPaidTrialOneShotGuardedProvider
} from '../api/_lib/ai/paid-trial-one-shot-provider.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
// prettier-ignore
const APPROVED = {
  commentId: 901,
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
  expiresAt: new Date(NOW + 3600000).toISOString(),
  ownerLedgerClaimed: true,
  exactScopeVerified: true
};
// prettier-ignore
const DEPLOYMENT = {
  projectRef: 'wmlzjgvxgoyrovdhbqbg',
  supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
  ready: true,
  isProduction: false,
  sha: SHA,
  id: 'dpl_test123'
};
const REQUEST = { model: 'gpt-5.6-luna', system: 'offline', user: 'synthetic' };

// prettier-ignore
function fixture({ changes = {}, deployment = {}, rpcReply, providerError } = {}) {
  let rpcCalls = 0;
  let modelCalls = 0;
  const consumed = new Set();
  const provider = createPaidTrialOneShotOpenAiProvider({
    approved: { ...APPROVED, ...changes },
    deployment: { ...DEPLOYMENT, ...deployment },
    now: () => NOW,
    serviceClient: {
      supabaseUrl: DEPLOYMENT.supabaseUrl,
      async rpc(name, args) {
        rpcCalls += 1;
        assert.equal(name, 'novelight_ai_020705_claim_once');
        assert.equal(args.p_project_ref, 'wmlzjgvxgoyrovdhbqbg');
        assert.equal(args.p_approval_comment_id, 901);
        if (rpcReply !== undefined) return rpcReply;
        if (consumed.has(args.p_approval_comment_id)) {
          return { data: false, error: null };
        }
        consumed.add(args.p_approval_comment_id);
        return { data: true, error: null };
      }
    },
    underlyingProvider: {
      async generate() {
        modelCalls += 1;
        if (providerError) throw providerError;
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  return { provider, counts: () => ({ rpcCalls, modelCalls }) };
}

// prettier-ignore
test('atomic claim is consumed once before a paid provider call', async () => {
  const { provider, counts } = fixture();
  assert.equal(isPaidTrialOneShotGuardedProvider(provider), true);
  const first = await provider.generate(REQUEST);
  assert.equal(first.text, '{"suggestions":[]}');
  await assert.rejects(
    provider.generate(REQUEST),
    /AI_020705_PAID_ONE_SHOT_DENIED/u
  );
  assert.deepEqual(counts(), { rpcCalls: 2, modelCalls: 1 });
});

// prettier-ignore
test('concurrent requests with the same claim never invoke the model twice', async () => {
  const { provider, counts } = fixture();
  const results = await Promise.allSettled([
    provider.generate(REQUEST),
    provider.generate(REQUEST),
    provider.generate(REQUEST)
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 2);
  assert.equal(counts().modelCalls, 1);
});

// prettier-ignore
test('network failure consumes the single use and never retries provider', async () => {
  const { provider, counts } = fixture({
    providerError: Object.assign(new Error('offline timeout'), {
      retryable: true
    })
  });
  await assert.rejects(provider.generate(REQUEST));
  await assert.rejects(
    provider.generate(REQUEST),
    /AI_020705_PAID_ONE_SHOT_DENIED/u
  );
  assert.equal(counts().modelCalls, 1);
});

// prettier-ignore
test('database outage and duplicate claims never reach network', async () => {
  for (const rpcReply of [
    { data: false, error: null },
    { data: null, error: { code: 'PGRST202' } },
    { data: 1, error: null }
  ]) {
    const { provider, counts } = fixture({ rpcReply });
    await assert.rejects(
      provider.generate(REQUEST),
      /AI_020705_PAID_ONE_SHOT_DENIED/u
    );
    assert.equal(counts().modelCalls, 0);
  }
});

// prettier-ignore
test('wrong deployment, budget, scope, expiry, model and claim fail closed', () => {
  const cases = [
    { changes: { ownerLedgerClaimed: false } },
    { changes: { exactScopeVerified: false } },
    { changes: { routeCount: 2 } },
    { changes: { fallbackDisabled: false } },
    { changes: { noRetry: false } },
    { changes: { capMicros: 10000001 } },
    { changes: { expiresAt: new Date(NOW).toISOString() } },
    { changes: { expiresAt: new Date(NOW + 3600001).toISOString() } },
    { changes: { model: 'unapproved-model' } },
    { changes: { mainSha: 'b'.repeat(40) } },
    { deployment: { projectRef: 'fiepaguycecrredwrcwx' } },
    { deployment: { isProduction: true } },
    { deployment: { ready: false } },
    { deployment: { id: 'dpl_other' } }
  ];
  for (const { changes, deployment } of cases) {
    assert.throws(
      () => fixture({ changes, deployment }),
      /AI_020705_PAID_ONE_SHOT_DENIED/u
    );
  }
});

// prettier-ignore
test('a model mismatch is rejected before any DB or network access', async () => {
  const { provider, counts } = fixture();
  await assert.rejects(
    provider.generate({ ...REQUEST, model: 'other-model' }),
    /AI_020705_PAID_ONE_SHOT_DENIED/u
  );
  assert.deepEqual(counts(), { rpcCalls: 0, modelCalls: 0 });
});

// prettier-ignore
test('migration is private service-only, immutable and atomically unique', () => {
  const sql = readFileSync(
    new URL(
      '../supabase/migrations/20261101060000_novelight_ai_020705_one_shot_claim.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(sql, /create table public\.novelight_ai_020705_one_shot_claims/u);
  assert.match(sql, /approval_comment_id bigint primary key/u);
  assert.match(sql, /unique \(main_sha, preview_deployment_id, actor_id, novel_id, episode_id\)/u);
  assert.match(sql, /on conflict do nothing/u);
  assert.match(sql, /current_user <> 'service_role'/u);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /from public, anon, authenticated/u);
  assert.match(sql, /to service_role/u);
  assert.match(sql, /v_runtime.enabled is not true/u);
  assert.doesNotMatch(sql, /delete from public\.novelight_ai_020705_one_shot_claims/iu);
});
