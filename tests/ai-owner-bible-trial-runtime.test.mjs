// An offline-only proof. Real providers, credentials, tokens and databases
// are never accessed by these tests.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerNovelBibleTrialRuntime } from '../api/_lib/ai/owner-novel-bible-trial-runtime.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-token-is-not-an-auth-jwt';
const CONTENT = '凛は青い鍵を持っていた。';
const REQUEST = { token: TOKEN, novelId: 41, episodeId: 11 };

function fixture({
  actor = OWNER,
  enabled = true,
  consent = true,
  budgetAllowed = true,
  onModelCall = null
} = {}) {
  const state = {
    actor,
    consent,
    auth: 0,
    authorClients: 0,
    modelCalls: 0,
    reservations: 0,
    settlements: 0,
    audits: 0,
    staged: 0,
    lastBatch: null
  };

  const serviceClient = {
    auth: {
      async getUser(token) {
        state.auth += 1;
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.actor } }, error: null };
      }
    },
    from(table) {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          if (table === 'novelight_ai_bible_facts') {
            return { data: [], error: null };
          }
          return { data: [], error: null };
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
          throw new Error('Unexpected offline table');
        },
        async insert() {
          if (table !== 'novelight_ai_usage_audit') {
            throw new Error('Unexpected offline write');
          }
          state.audits += 1;
          return { error: null };
        }
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'novelight_ai_reserve_usage') {
        state.reservations += 1;
        assert.equal(args.p_actor_id, OWNER);
        return {
          data: budgetAllowed ? OWNER : null,
          error: null
        };
      }
      if (name === 'novelight_ai_settle_usage') {
        state.settlements += 1;
        return { data: true, error: null };
      }
      if (name === 'novelight_ai_review_stage_batch') {
        state.staged += 1;
        state.lastBatch = args;
        return { data: 1, error: null };
      }
      throw new Error('Unexpected offline RPC');
    }
  };
  const authorClient = {
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
  const runtime = createOwnerNovelBibleTrialRuntime({
    enabled,
    externalProcessingApproved: true,
    ownerId: OWNER,
    authClient: serviceClient,
    serviceClient,
    createAuthorClient({ token, actorId }) {
      state.authorClients += 1;
      assert.equal(token, TOKEN);
      assert.equal(actorId, OWNER);
      return authorClient;
    },
    permissionCheck: async ({ actorId, novelId, episodeId, purpose }) => {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 41);
      assert.equal(episodeId, 11);
      assert.equal(purpose, 'external-novel-bible-analysis');
      return state.consent;
    },
    providers: {
      local: {
        async generate({ model, system, user }) {
          state.modelCalls += 1;
          assert.equal(model, 'offline-mock');
          assert.match(system, /untrusted data/u);
          assert.equal(JSON.parse(user).untrusted_excerpt, CONTENT);
          if (onModelCall) onModelCall(state);
          return {
            text: JSON.stringify({
              suggestions: [
                {
                  kind: 'character',
                  key: '凛',
                  summary: '青い鍵を持つ人物。',
                  evidence: CONTENT
                }
              ]
            }),
            usage: { inputTokens: 30, outputTokens: 30 }
          };
        }
      }
    },
    routes: {
      'novel-bible': [
        {
          provider: 'local',
          model: 'offline-mock',
          inputMicrosPerMillion: 1000000,
          outputMicrosPerMillion: 2000000,
          maxOutputTokens: 128
        }
      ]
    }
  });
  return { runtime, state };
}

test('default OFF denies before authentication and providers', async () => {
  const { runtime, state } = fixture({ enabled: false });
  await assert.rejects(runtime.stage(REQUEST), /AI_TRIAL_RUNTIME_DISABLED/u);
  assert.equal(state.auth, 0);
  assert.equal(state.authorClients, 0);
  assert.equal(state.reservations, 0);
});

test('auth mismatch denies before opening author JWT client', async () => {
  const { runtime, state } = fixture({ actor: OTHER });
  await assert.rejects(runtime.stage(REQUEST), /AI_TRIAL_RUNTIME_DENIED/u);
  assert.equal(state.auth, 1);
  assert.equal(state.authorClients, 0);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.reservations, 0);
});

test('consent refusal prevents atomic reserve and provider', async () => {
  const { runtime, state } = fixture({ consent: false });
  await assert.rejects(runtime.stage(REQUEST), /AI_BIBLE_MODEL_BRIDGE_DENIED/u);
  assert.equal(state.reservations, 0);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.staged, 0);
});

test('zero budget refuses before any paid-model equivalent', async () => {
  const { runtime, state } = fixture({ budgetAllowed: false });
  await assert.rejects(runtime.stage(REQUEST), /AI_BUDGET_DENIED/u);
  assert.equal(state.reservations, 1);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.staged, 0);
});

test('owner synthetic trial goes through real adapters and review RPC', async () => {
  const { runtime, state } = fixture();
  const result = await runtime.stage(REQUEST);
  assert.deepEqual(result, {
    novelId: 41,
    stagedCount: 1,
    requiresAuthorReview: true
  });
  assert.equal(state.authorClients, 1);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reservations, 1);
  assert.equal(state.settlements, 1);
  assert.equal(state.audits, 1);
  assert.equal(state.staged, 1);
  assert.match(state.lastBatch.p_source_hash, /^[a-f0-9]{64}$/u);
  assert.match(state.lastBatch.p_request_hash, /^[a-f0-9]{64}$/u);
  assert.equal(state.lastBatch.p_candidates[0].evidence, CONTENT);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.ok(!JSON.stringify(result).includes(CONTENT));
});

test('revoked consent after model settlement never writes candidates', async () => {
  const { runtime, state } = fixture({
    onModelCall(current) {
      current.consent = false;
    }
  });
  await assert.rejects(runtime.stage(REQUEST), /AI_BIBLE_MODEL_BRIDGE_DENIED/u);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.settlements, 1);
  assert.equal(state.staged, 0);
});

test('configuration refuses an absent trusted consent provider', () => {
  assert.throws(
    () => createOwnerNovelBibleTrialRuntime({ enabled: true }),
    /AI_TRIAL_RUNTIME_UNAVAILABLE/u
  );
});
