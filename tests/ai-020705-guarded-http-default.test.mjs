import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  createOwnerNovelBible020705GuardedLiveTrialBridge,
  resolve020705GuardedTrialScope
} from '../api/_lib/ai/owner-novel-bible-020705-guarded-live.js';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const OWNER = '11111111-1111-4111-8111-111111111111';
const PREVIEW = 'dpl_synthetic123';
const COMMENT_ID = 777;
const RUN_ID = 1001;

// prettier-ignore
const FLAGS = [
  'NOVELIGHT_AI_ENABLED', 'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED', 'NOVELIGHT_AI_MODEL_TRIAL_ENABLED',
  'NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED',
  'NOVELIGHT_AI_CONSENT_UI_ENABLED',
  'NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED',
  'NOVELIGHT_AI_TRIAL_LIVE_BINDING_ENABLED'
];

function config() {
  return {
    ...Object.fromEntries(FLAGS.map((name) => [name, 'true'])),
    NOVELIGHT_AI_020705_ONE_SHOT_ENABLED: 'true',
    NOVELIGHT_AI_020705_APPROVAL_ISSUE_NUMBER: '294',
    NOVELIGHT_AI_020705_APPROVAL_COMMENT_ID: String(COMMENT_ID),
    NOVELIGHT_AI_020705_APPROVAL_RUN_ID: String(RUN_ID),
    NOVELIGHT_AI_020705_APPROVED_MAIN_SHA: SHA,
    NOVELIGHT_AI_020705_PREVIEW_DEPLOYMENT_ID: PREVIEW,
    VERCEL_GIT_COMMIT_SHA: SHA,
    VERCEL_DEPLOYMENT_ID: PREVIEW,
    VERCEL_ENV: 'preview',
    SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_public_key',
    SUPABASE_SECRET_KEY: 'synthetic-server-secret-not-real',
    OPENAI_API_KEY: 'synthetic-no-real-api-key-123456',
    NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
    NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID: '41',
    NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID: '11',
    NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX: '0',
    NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS: '10000000',
    NOVELIGHT_AI_TRIAL_EXPIRES_AT: new Date(NOW + 3600000).toISOString(),
    NOVELIGHT_AI_CONSENT_POLICY_REVISION: 'synthetic-policy-v1',
    NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([{
      processor: 'openai',
      label: 'Synthetic provider',
      purpose: 'synthetic-only extraction',
      dataSent: 'synthetic text',
      retention: 'mock, no transfer',
      internationalTransfer: 'mock, no transfer'
    }]),
    NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify([{
      provider: 'openai', model: 'gpt-5.6-luna',
      inputMicrosPerMillion: 60000000,
      outputMicrosPerMillion: 360000000,
      maxOutputTokens: 1024
    }])
  };
}

function comments({ consumed = false, claimed = true } = {}) {
  const payload = {
    actorId: OWNER,
    approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 10000000,
    confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: 'synthetic-policy-v1',
    episodeId: 11,
    expiresAt: new Date(NOW + 3600000).toISOString(),
    mainSha: SHA,
    model: 'gpt-5.6-luna',
    novelId: 41,
    previewDeploymentId: PREVIEW,
    provider: 'openai',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
  };
  const result = [{
    id: COMMENT_ID,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body: 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
      JSON.stringify(payload)
  }];
  const claim = {
    approvalCommentId: COMMENT_ID,
    mainSha: SHA,
    previewDeploymentId: PREVIEW,
    runId: RUN_ID
  };
  if (claimed) {
    result.push({
      id: 9001, user: { login: 'github-actions[bot]' },
      body: 'NOVELIGHT_STAGING_AI_020705_PAID_CLAIMED ' +
        JSON.stringify(claim)
    });
  }
  if (consumed) {
    result.push({
      id: 9002, user: { login: 'github-actions[bot]' },
      body: 'NOVELIGHT_STAGING_AI_020705_PAID_CONSUMED ' +
        JSON.stringify({ approvalCommentId: COMMENT_ID, runId: RUN_ID, result: 'success' })
    });
  }
  return result;
}

function client() {
  return {
    supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    auth: { async getUser() { throw Error('Scope failure should occur before Auth'); } },
    rpc() { throw Error('Scope failure should occur before DB'); },
    from() { throw Error('Scope failure should occur before DB'); }
  };
}

test('production HTTP default is the guarded bridge, never legacy', () => {
  const s = readFileSync(
    new URL('../api/ai-owner-bible-analyze.js', import.meta.url),
    'utf8'
  );
  assert.match(s, /createTrialBridge: createOwnerNovelBible020705GuardedLiveTrialBridge\(\)/u);
  assert.doesNotMatch(s, /createTrialBridge: createOwnerNovelBibleLiveTrialBridge\(\)/u);
  assert.equal(createOwnerNovelBible020705GuardedLiveTrialBridge({ env: {} }), null);
});

test('Staging and exact Preview must match, old flags cannot bypass guard', () => {
  const base = config();
  const bad = [
    { NOVELIGHT_AI_020705_ONE_SHOT_ENABLED: 'false' },
    { NOVELIGHT_AI_020705_APPROVAL_ISSUE_NUMBER: '123' },
    { VERCEL_ENV: 'production' },
    { SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co' },
    { VERCEL_DEPLOYMENT_ID: 'dpl_wrong' },
    { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) },
    { NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX: '1' },
    { NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS: '10000001' },
    { NOVELIGHT_AI_020705_APPROVAL_COMMENT_ID: undefined },
    { NOVELIGHT_AI_020705_APPROVAL_RUN_ID: undefined },
    { NOVELIGHT_AI_TRIAL_EXPIRES_AT: new Date(NOW + 3600001).toISOString() },
    { NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify([
      JSON.parse(base.NOVELIGHT_AI_TRIAL_ROUTES_JSON)[0],
      { ...JSON.parse(base.NOVELIGHT_AI_TRIAL_ROUTES_JSON)[0], provider: 'gemini' }
    ]) },
    { NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify([
      { ...JSON.parse(base.NOVELIGHT_AI_TRIAL_ROUTES_JSON)[0], model: 'other-model' }
    ]) }
  ];
  for (const changes of bad) {
    assert.equal(resolve020705GuardedTrialScope({ ...base, ...changes }, NOW), null);
    assert.equal(
      createOwnerNovelBible020705GuardedLiveTrialBridge({
        env: { ...base, ...changes },
        now: () => NOW
      }), null
    );
  }
  assert.ok(resolve020705GuardedTrialScope(base, NOW));
});

test('verified OWNER and claimed GitHub ledger bind one guarded author bridge', async () => {
  let providerCreated = 0;
  const factory = createOwnerNovelBible020705GuardedLiveTrialBridge({
    env: config(),
    now: () => NOW,
    readComments: async ({ issueNumber }) => {
      assert.equal(issueNumber, 294);
      return comments();
    },
    openAiProviderFactory() {
      providerCreated += 1;
      return {
        async generate() {
          throw Error('Offline test never calls a provider');
        }
      };
    }
  });
  assert.equal(typeof factory, 'function');
  const result = await factory({ ownerId: OWNER, serviceClient: client() });
  assert.equal(typeof result.stage, 'function');
  assert.equal(providerCreated, 1);
  await assert.rejects(
    result.stage({ novelId: 42, episodeId: 11, chunkIndex: 0 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
});

test('no owner claim, consumed claim, mismatched owner or GitHub outage deny', async () => {
  for (const item of [
    { readComments: async () => comments({ claimed: false }) },
    { readComments: async () => comments({ consumed: true }) },
    { readComments: async () => {
      const c = comments();
      c[1].user.login = 'untrusted';
      return c;
    } },
    { readComments: async () => { throw Error('GitHub is unavailable'); } }
  ]) {
    let providerCreated = 0;
    const factory = createOwnerNovelBible020705GuardedLiveTrialBridge({
      env: config(),
      now: () => NOW,
      ...item,
      openAiProviderFactory() {
        providerCreated += 1;
        throw Error('must not construct a provider');
      }
    });
    await assert.rejects(
      factory({ ownerId: OWNER, serviceClient: client() }),
      /AI_020705_GUARDED_TRIAL_DENIED/u
    );
    assert.equal(providerCreated, 0);
  }
});

test('wrong client, wrong owner and expired proof deny before model creation', async () => {
  const factory = createOwnerNovelBible020705GuardedLiveTrialBridge({
    env: config(), now: () => NOW,
    readComments: async () => comments()
  });
  await assert.rejects(
    factory({
      ownerId: OWNER,
      serviceClient: { ...client(), supabaseUrl: 'https://fiepaguycecrredwrcwx.supabase.co' }
    }),
    /AI_020705_GUARDED_TRIAL_DENIED/u
  );
  await assert.rejects(
    factory({ ownerId: '22222222-2222-4222-8222-222222222222', serviceClient: client() }),
    /AI_020705_GUARDED_TRIAL_DENIED/u
  );
});
