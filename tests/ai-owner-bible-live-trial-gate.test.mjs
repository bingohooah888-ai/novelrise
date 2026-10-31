import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createOwnerNovelBibleLiveTrialBridge } from '../api/_lib/ai/owner-novel-bible-trial-live.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-31T08:00:00.000Z');
const FLAGS = [
  'NOVELIGHT_AI_ENABLED',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED',
  'NOVELIGHT_AI_MODEL_TRIAL_ENABLED',
  'NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED',
  'NOVELIGHT_AI_CONSENT_UI_ENABLED',
  'NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED',
  'NOVELIGHT_AI_TRIAL_LIVE_BINDING_ENABLED'
];

function approvedEnv() {
  const env = Object.fromEntries(FLAGS.map((flag) => [flag, 'true']));
  return {
    ...env,
    NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_public_key',
    OPENAI_API_KEY: 'offline-placeholder-no-valid-key',
    NOVELIGHT_AI_CONSENT_POLICY_REVISION: 'synthetic-policy-v1',
    NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([
      {
        processor: 'openai',
        label: '架空の処理事業者',
        purpose: '合成原稿の抽出',
        dataSent: '合成文章',
        retention: 'テストで通信なし',
        internationalTransfer: 'テストで通信なし'
      }
    ]),
    NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify([
      {
        provider: 'openai',
        model: 'synthetic-test',
        inputMicrosPerMillion: 1000000,
        outputMicrosPerMillion: 2000000,
        maxOutputTokens: 128
      }
    ]),
    NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID: '41',
    NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID: '11',
    NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX: '0',
    NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS: '1000000',
    NOVELIGHT_AI_TRIAL_EXPIRES_AT: new Date(
      NOW + 3600000
    ).toISOString()
  };
}

function build(env = approvedEnv(), options = {}) {
  let providerFactories = 0;
  const factory = createOwnerNovelBibleLiveTrialBridge({
    env,
    now: options.now || (() => NOW),
    openAiProviderFactory({ apiKey }) {
      assert.equal(apiKey, 'offline-placeholder-no-valid-key');
      providerFactories += 1;
      return {
        async generate() {
          throw new Error('A synthetic test must never call the provider');
        }
      };
    },
    createClientImpl() {
      throw new Error('Scope rejection must not create an author client');
    }
  });
  return { factory, providerFactories: () => providerFactories };
}

test('live trial is OFF unless all independent activation flags are on', () => {
  const base = approvedEnv();
  assert.equal(createOwnerNovelBibleLiveTrialBridge({ env: {} }), null);
  for (const flag of FLAGS) {
    const result = build({ ...base, [flag]: 'false' });
    assert.equal(result.factory, null, flag);
    assert.equal(result.providerFactories(), 0, flag);
  }
});

test('unapproved model, consent, expiry, scope or spend fails closed', () => {
  const base = approvedEnv();
  const variants = [
    { OPENAI_API_KEY: undefined },
    { NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID: '0' },
    { NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID: 'not-a-number' },
    { NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX: '1' },
    { NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS: '1' },
    { NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS: '50000001' },
    { NOVELIGHT_AI_TRIAL_EXPIRES_AT: new Date(NOW).toISOString() },
    {
      NOVELIGHT_AI_TRIAL_EXPIRES_AT: new Date(
        NOW + 25 * 3600000
      ).toISOString()
    },
    { NOVELIGHT_AI_CONSENT_POLICY_REVISION: '' },
    {
      NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([
        {
          processor: 'gemini',
          label: '別送信先',
          purpose: '検証',
          dataSent: '合成文章',
          retention: '送らない',
          internationalTransfer: '送らない'
        }
      ])
    },
    {
      NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify([
        {
          provider: 'openai',
          model: 'synthetic-test',
          inputMicrosPerMillion: 999999999999999,
          outputMicrosPerMillion: 999999999999999,
          maxOutputTokens: 128
        }
      ])
    }
  ];
  for (const changes of variants) {
    assert.equal(
      build({ ...base, ...changes }).factory,
      null,
      Object.keys(changes).join(',')
    );
  }
});

test('valid synthetic config binds only one work/episode for 24 hours', async () => {
  let current = NOW;
  const output = build(approvedEnv(), { now: () => current });
  assert.equal(typeof output.factory, 'function');
  assert.equal(output.providerFactories(), 1);
  const runtime = await output.factory({
    ownerId: OWNER,
    serviceClient: {
      auth: {
        async getUser() {
          throw new Error('Scope must be checked before Auth');
        }
      },
      from() {
        throw new Error('Scope must be checked before DB');
      },
      rpc() {
        throw new Error('Scope must be checked before DB write');
      }
    }
  });
  for (const scope of [
    { novelId: 42, episodeId: 11, chunkIndex: 0 },
    { novelId: 41, episodeId: 12, chunkIndex: 0 },
    { novelId: 41, episodeId: 11, chunkIndex: 1 }
  ]) {
    await assert.rejects(
      runtime.stage(scope),
      /AI_BIBLE_MODEL_BRIDGE_DENIED/
    );
  }
  current = NOW + 3600000;
  await assert.rejects(
    runtime.stage({ novelId: 41, episodeId: 11, chunkIndex: 0 }),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/
  );
});

test('production HTTP default uses independent live activation, not direct bridge', () => {
  const source = readFileSync(
    new URL('../api/ai-owner-bible-analyze.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /createOwnerNovelBibleLiveTrialBridge\(\)/);
  assert.match(source, /createTrialBridge: createOwnerNovelBibleLiveTrialBridge/);
});
