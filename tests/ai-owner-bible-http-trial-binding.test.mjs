// Fully synthetic HTTP -> consent -> budget -> model -> pending review proof.
// Never uses hosted Auth, production manuscripts, provider keys or network.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleAnalyzeApiHandler } from '../api/ai-owner-bible-analyze.js';
import { createOwnerNovelBibleTrialBridgeFactory } from '../api/_lib/ai/owner-novel-bible-trial-binding.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-token-not-an-actual-jwt';
const CONTENT = '凛は青い鍵を持っていた。';
const KEY = 'sb_publishable_synthetic_public_key';
const ROUTES = {
  'novel-bible': [
    {
      provider: 'openai',
      model: 'offline-synthetic',
      inputMicrosPerMillion: 1000000,
      outputMicrosPerMillion: 2000000,
      maxOutputTokens: 128
    }
  ]
};
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_REVIEW_ENABLED: 'true',
  NOVELIGHT_AI_MODEL_TRIAL_ENABLED: 'true',
  NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED: 'true',
  NOVELIGHT_AI_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: KEY,
  SUPABASE_SECRET_KEY: 'offline-fake-secret-do-not-use'
};

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function fixture({
  actor = OWNER,
  consent = true,
  budget = true,
  enabled = true
} = {}) {
  const state = {
    actor,
    consent,
    budget,
    modelCalls: 0,
    reserveCalls: 0,
    stageCalls: 0,
    authorClients: 0,
    auditCalls: 0
  };

  const serviceClient = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.actor } }, error: null };
      }
    },
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return this;
        },
        async maybeSingle() {
          if (table === 'novels') {
            return { data: { id: 41, user_id: OWNER }, error: null };
          }
          if (table === 'episodes') {
            return {
              data: {
                id: 11,
                novel_id: 41,
                title: '第一話',
                content: CONTENT
              },
              error: null
            };
          }
          throw new Error('Unexpected private table read');
        },
        async limit() {
          if (table === 'novelight_ai_external_processing_consents') {
            const granted = new Date(Date.now() - 1000).toISOString();
            const expires = new Date(Date.now() + 86400000).toISOString();
            return {
              data: [
                {
                  processor: 'openai',
                  policy_revision: 'offline-policy-v1',
                  granted_at: granted,
                  expires_at: expires,
                  revoked_at: state.consent ? null : granted
                }
              ],
              error: null
            };
          }
          if (table === 'novelight_ai_bible_facts') {
            return { data: [], error: null };
          }
          throw new Error('Unexpected private list');
        },
        async insert() {
          assert.equal(table, 'novelight_ai_usage_audit');
          state.auditCalls += 1;
          return { error: null };
        }
      };
    },
    async rpc(name) {
      if (name === 'novelight_ai_reserve_usage') {
        state.reserveCalls += 1;
        return {
          data: state.budget ? OWNER : null,
          error: null
        };
      }
      if (name === 'novelight_ai_settle_usage') {
        return { data: true, error: null };
      }
      if (name === 'novelight_ai_review_stage_batch') {
        state.stageCalls += 1;
        return { data: 1, error: null };
      }
      throw new Error('Unexpected write: ' + name);
    }
  };

  const bridgeFactory = createOwnerNovelBibleTrialBridgeFactory({
    enabled,
    externalProcessingApproved: true,
    config: {
      id: OWNER,
      url: ENV.SUPABASE_URL,
      key: KEY
    },
    policyRevision: 'offline-policy-v1',
    routes: ROUTES,
    providers: {
      openai: {
        async generate() {
          state.modelCalls += 1;
          return {
            text: JSON.stringify({
              suggestions: [
                {
                  kind: 'character',
                  key: '凛',
                  summary: '青い鍵を持つ。',
                  evidence: CONTENT
                }
              ]
            }),
            usage: { inputTokens: 20, outputTokens: 30 }
          };
        }
      }
    },
    createClientImpl(url, key, options) {
      state.authorClients += 1;
      assert.equal(url, ENV.SUPABASE_URL);
      assert.equal(key, KEY);
      assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
      return {
        auth: serviceClient.auth,
        async rpc(name) {
          if (
            name !== 'novelight_author_character_list' &&
            name !== 'novelight_private_story_notes'
          ) {
            throw new Error('Unexpected author RPC');
          }
          return { data: [], error: null };
        }
      };
    }
  });

  const handler = createOwnerBibleAnalyzeApiHandler({
    env: ENV,
    createServiceClient(url, secret) {
      assert.equal(url, ENV.SUPABASE_URL);
      assert.equal(secret, ENV.SUPABASE_SECRET_KEY);
      return serviceClient;
    },
    createTrialBridge: bridgeFactory
  });

  async function invoke() {
    const res = response();
    await handler(
      {
        method: 'POST',
        headers: {
          host: 'novelight.jp',
          origin: 'https://novelight.jp',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'x-novelight-ai-trial': '1',
          authorization: 'Bearer ' + TOKEN
        },
        body: { novelId: 41, episodeId: 11, chunkIndex: 0 }
      },
      res
    );
    return res;
  }
  return { invoke, state };
}

test('OFF-by-default binding never constructs a runtime', () => {
  assert.equal(createOwnerNovelBibleTrialBridgeFactory(), null);
  assert.equal(
    createOwnerNovelBibleTrialBridgeFactory({
      enabled: true,
      externalProcessingApproved: false
    }),
    null
  );
});

test('explicit synthetic owner HTTP flow stages pending candidates', async () => {
  const { invoke, state } = fixture();
  const result = await invoke();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    novelId: 41,
    stagedCount: 1,
    requiresAuthorReview: true
  });
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reserveCalls, 1);
  assert.equal(state.stageCalls, 1);
  assert.equal(state.auditCalls, 1);
  assert.equal(state.authorClients, 1);
  assert.ok(!JSON.stringify(result).includes(CONTENT));
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('absent grant blocks provider and budget before model invocation', async () => {
  const { invoke, state } = fixture({ consent: false });
  const result = await invoke();
  assert.equal(result.statusCode, 404);
  assert.equal(state.reserveCalls, 0);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.stageCalls, 0);
});

test('zero budget blocks provider and persistence', async () => {
  const { invoke, state } = fixture({ budget: false });
  const result = await invoke();
  assert.equal(result.statusCode, 429);
  assert.equal(state.reserveCalls, 1);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.stageCalls, 0);
});

test('other user is denied before client or provider creation', async () => {
  const { invoke, state } = fixture({ actor: OTHER });
  const result = await invoke();
  assert.equal(result.statusCode, 404);
  assert.equal(state.authorClients, 0);
  assert.equal(state.modelCalls, 0);
});

test('missing policy or approved routes fail closed', () => {
  const options = {
    enabled: true,
    externalProcessingApproved: true,
    config: { id: OWNER, url: ENV.SUPABASE_URL, key: KEY },
    policyRevision: 'offline-policy-v1',
    routes: ROUTES,
    providers: { openai: { generate: async () => ({}) } }
  };
  assert.throws(
    () => createOwnerNovelBibleTrialBridgeFactory({
      ...options,
      policyRevision: undefined
    }),
    /AI_TRIAL_BINDING_UNAVAILABLE/
  );
  assert.throws(
    () => createOwnerNovelBibleTrialBridgeFactory({
      ...options,
      routes: { 'novel-bible': [{ provider: 'unknown', model: 'x' }] }
    }),
    /AI_TRIAL_BINDING_UNAVAILABLE/
  );
});
