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
// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
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
// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
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

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
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

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
function fixture({
  actor = OWNER,
  consent = true,
  budget = true,
  enabled = true,
  checkpointEnabled = false,
  checkpointRepository,
  offlinePlanEnabled = false,
  episodeContent = CONTENT
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
          if (table === 'novelight_ai_runtime_settings') {
            return {
              data: {
                enabled: true,
                user_day_cap_micros: 1000000,
                user_month_cap_micros: 1000000,
                global_day_cap_micros: 1000000,
                global_month_cap_micros: 1000000
              },
              error: null
            };
          }
          if (table === 'novels') {
            return { data: { id: 41, user_id: OWNER }, error: null };
          }
          if (table === 'episodes') {
            return {
              data: {
                id: 11,
                novel_id: 41,
                user_id: OWNER,
                title: '第一話',
                content: episodeContent
              },
              error: null
            };
          }
          if (table === 'novelight_ai_episode_analysis') {
            return {
              data: checkpointRepository?.snapshot?.() ?? null,
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
    checkpointEnabled,
    ...(checkpointRepository === undefined ? {} : { checkpointRepository }),
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
                  evidence: episodeContent === CONTENT ? CONTENT : '青'
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
    env: offlinePlanEnabled
      ? {
          ...ENV,
          // Only synthetic GET-readiness needs these explicit disclosure,
          // approved-work and processor-policy fields. Production is OFF.
          NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED: 'true',
          NOVELIGHT_AI_CONSENT_POLICY_REVISION: 'offline-policy-v1',
          NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON: JSON.stringify([
            {
              processor: 'openai',
              label: '架空モデル',
              purpose: '合成テスト',
              dataSent: '架空原稿',
              retention: '保存しない',
              internationalTransfer: '通信しない'
            }
          ]),
          NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID: '41',
          NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID: '11',
          NOVELIGHT_AI_TRIAL_ROUTES_JSON: JSON.stringify(
            ROUTES['novel-bible']
          )
        }
      : ENV,
    offlinePlanEnabled,
    createServiceClient(url, secret) {
      assert.equal(url, ENV.SUPABASE_URL);
      assert.equal(secret, ENV.SUPABASE_SECRET_KEY);
      return serviceClient;
    },
    createTrialBridge: bridgeFactory
  });

  async function invoke({ chunkIndex = 0 } = {}) {
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
        body: { novelId: 41, episodeId: 11, chunkIndex }
      },
      res
    );
    return res;
  }
  async function inspect() {
    const res = response();
    await handler({
      method: 'GET',
      headers: {
        host: 'novelight.jp',
        origin: 'https://novelight.jp',
        'sec-fetch-site': 'same-origin',
        'x-novelight-ai-trial-plan': '1',
        authorization: 'Bearer ' + TOKEN
      },
      query: { novel_id: '41', episode_id: '11' }
    }, res);
    return res;
  }
  return { invoke, inspect, state };
}

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
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

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
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

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
test('absent grant blocks provider and budget before model invocation', async () => {
  const { invoke, state } = fixture({ consent: false });
  const result = await invoke();
  assert.equal(result.statusCode, 404);
  assert.equal(state.reserveCalls, 0);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.stageCalls, 0);
});

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
test('zero budget blocks provider and persistence', async () => {
  const { invoke, state } = fixture({ budget: false });
  const result = await invoke();
  assert.equal(result.statusCode, 429);
  assert.equal(state.reserveCalls, 1);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.stageCalls, 0);
});

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
test('other user is denied before client or provider creation', async () => {
  const { invoke, state } = fixture({ actor: OTHER });
  const result = await invoke();
  assert.equal(result.statusCode, 404);
  assert.equal(state.authorClients, 0);
  assert.equal(state.modelCalls, 0);
});

// Keep the synthetic in-memory fixture verbatim; no external data is used.
// prettier-ignore
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

// Synthetic shared authoritative CAS journal, no database/provider access.
// prettier-ignore
function checkpointStore() {
  let row = null;
  let writes = 0;
  return {
    snapshot: () => row,
    get writes() { return writes; },
    async readSnapshot() { return row; },
    async compareAndSwap(change) {
      if (
        change.actorId !== OWNER ||
        change.novelId !== 41 ||
        change.episodeId !== 11 ||
        change.expectedRevision !== (row?.revision ?? null) ||
        change.expectedSourceHash !== (row?.source_hash ?? null)
      ) return null;
      row = {
        episode_id: 11,
        revision: (row?.revision ?? 0) + 1,
        source_hash: change.nextSourceHash,
        summary: change.nextSummary
      };
      writes += 1;
      return row;
    }
  };
}

// Three independent HTTP handler/runtime constructions reuse one CAS row.
// The next offset is computed from the verified server row, never a cookie.
// prettier-ignore
test('owner HTTP resumes a persisted partial checkpoint and never bills a completed chunk twice', async () => {
  const checkpointRepository = checkpointStore();
  const make = () => fixture({
    offlinePlanEnabled: true,
    checkpointEnabled: true,
    checkpointRepository,
    episodeContent: '青'.repeat(3100)
  });
  const first = make();
  const before = await first.inspect();
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.status, 'ready');
  assert.equal(before.body.chunkCount, 3);
  assert.equal(before.body.nextChunkIndex, 0);
  assert.equal(first.state.reserveCalls, 0);
  const one = await first.invoke({ chunkIndex: 0 });
  assert.equal(one.statusCode, 200);
  assert.equal(one.body.stagedCount, 1);
  assert.equal(first.state.modelCalls, 1);
  assert.equal(checkpointRepository.writes, 1);
  assert.deepEqual(checkpointRepository.snapshot().summary.novelightPhase2.completedIndices, [0]);

  const fresh = make();
  const next = await fresh.inspect();
  assert.equal(next.statusCode, 200);
  assert.equal(next.body.status, 'ready');
  assert.equal(next.body.nextChunkIndex, 1);
  const duplicate = await fresh.invoke({ chunkIndex: 0 });
  assert.deepEqual(duplicate.body, {
    novelId: 41, stagedCount: 0, requiresAuthorReview: false
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(fresh.state.reserveCalls, 0);
  assert.equal(fresh.state.modelCalls, 0);
  assert.equal(fresh.state.stageCalls, 0);
  assert.equal(checkpointRepository.writes, 1);

  const two = await fresh.invoke({ chunkIndex: 1 });
  assert.equal(two.statusCode, 200);
  assert.equal(two.body.stagedCount, 1);
  assert.equal(checkpointRepository.writes, 2);
  const last = make();
  assert.equal((await last.inspect()).body.nextChunkIndex, 2);
  assert.equal((await last.invoke({ chunkIndex: 2 })).statusCode, 200);
  assert.equal(checkpointRepository.writes, 3);
  assert.equal(checkpointRepository.snapshot().summary.novelightPhase2.state, 'complete');

  const restored = make();
  const finished = await restored.inspect();
  assert.equal(finished.statusCode, 200);
  assert.equal(finished.body.nextChunkIndex, null);
  assert.equal(finished.body.status, 'unchanged');
  const again = await restored.invoke({ chunkIndex: 0 });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.body, {
    novelId: 41, stagedCount: 0, requiresAuthorReview: false
  });
  assert.equal(restored.state.reserveCalls, 0);
  assert.equal(restored.state.modelCalls, 0);
  assert.equal(restored.state.stageCalls, 0);
  assert.equal(checkpointRepository.writes, 3);
});

// Both opt-ins must be explicit; an untrusted/broken repository is denied.
// prettier-ignore
test('checkpoint HTTP plan remains OFF by default and rejects invalid injection', async () => {
  const ordinary = fixture();
  assert.equal((await ordinary.inspect()).statusCode, 405);
  assert.equal(ordinary.state.reserveCalls, 0);
  assert.equal(ordinary.state.modelCalls, 0);

  const config = {
    enabled: true,
    externalProcessingApproved: true,
    config: { id: OWNER, url: ENV.SUPABASE_URL, key: KEY },
    policyRevision: 'offline-policy-v1',
    routes: ROUTES,
    providers: { openai: { async generate() { throw new Error('MUST_NOT_CALL'); } } }
  };
  assert.throws(() => createOwnerNovelBibleTrialBridgeFactory({
    ...config, checkpointRepository: checkpointStore()
  }), /AI_TRIAL_BINDING_UNAVAILABLE/u);
  assert.throws(() => createOwnerNovelBibleTrialBridgeFactory({
    ...config, checkpointEnabled: true,
    checkpointRepository: { readSnapshot() {} }
  }), /AI_TRIAL_BINDING_UNAVAILABLE/u);
});
