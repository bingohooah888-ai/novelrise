// An offline-only proof. Real providers, credentials, tokens and databases
// are never accessed by these tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  runtimeEnabled = true,
  onReserve = null,
  onModelCall = null,
  historicalText = null,
  currentText = CONTENT,
  retainedRevisionText = historicalText,
  expectedExcerpt = currentText,
  checkpointEnabled = false,
  checkpointRepository
} = {}) {
  const state = {
    actor,
    consent,
    runtimeEnabled,
    auth: 0,
    authorClients: 0,
    modelCalls: 0,
    reservations: 0,
    settlements: 0,
    settlementCharges: [],
    audits: 0,
    staged: 0,
    lastBatch: null,
    historyReads: 0
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
          if (table === 'episode_revisions') {
            state.historyReads += 1;
            return {
              data:
                retainedRevisionText === null
                  ? []
                  : [
                      {
                        id: '33333333-3333-4333-8333-333333333333',
                        episode_id: 11,
                        novel_id: 41,
                        user_id: OWNER,
                        title: '第一話',
                        content: retainedRevisionText,
                        created_at: new Date().toISOString()
                      }
                    ],
              error: null
            };
          }
          return { data: [], error: null };
        },
        async maybeSingle() {
          if (table === 'novelight_ai_runtime_settings') {
            return {
              data: {
                enabled: state.runtimeEnabled,
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
                content: currentText
              },
              error: null
            };
          }
          if (table === 'novelight_ai_episode_analysis') {
            return {
              data:
                historicalText === null
                  ? null
                  : {
                      episode_id: 11,
                      source_hash: createHash('sha256')
                        .update(JSON.stringify(['第一話', historicalText]))
                        .digest('hex'),
                      revision: 1
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
        if (onReserve) onReserve(state);
        return {
          data: budgetAllowed ? OWNER : null,
          error: null
        };
      }
      if (name === 'novelight_ai_settle_usage') {
        state.settlements += 1;
        state.settlementCharges.push(args.p_charged_micros);
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
    checkpointEnabled,
    checkpointRepository,
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
          assert.equal(JSON.parse(user).untrusted_excerpt, expectedExcerpt);
          if (onModelCall) onModelCall(state);
          return {
            text: JSON.stringify({
              suggestions: [
                {
                  kind: 'character',
                  key: '凛',
                  summary: '青い鍵を持つ人物。',
                  evidence: expectedExcerpt
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

test('trusted database checkpoint selects only the edited Japanese excerpt in one-shot trial', async () => {
  const { runtime, state } = fixture({
    historicalText: '凛は赤い鍵を持っていた。',
    currentText: '凛は青い鍵を持っていた。',
    expectedExcerpt: '青'
  });
  const result = await runtime.stage(REQUEST);
  assert.equal(result.stagedCount, 1);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.staged, 1);
  assert.equal(state.historyReads, 2);
  assert.equal(state.lastBatch.p_candidates[0].evidence, '青');
});

test('trusted checkpoint with unchanged chapter skips model and review RPC', async () => {
  const { runtime, state } = fixture({
    historicalText: CONTENT,
    currentText: CONTENT
  });
  const result = await runtime.stage(REQUEST);
  assert.deepEqual(result, {
    novelId: 41,
    stagedCount: 0,
    requiresAuthorReview: false
  });
  assert.equal(state.modelCalls, 0);
  assert.equal(state.reservations, 0);
  assert.equal(state.staged, 0);
});

test('expired or missing retained history fails back to full current chapter', async () => {
  const { runtime, state } = fixture({
    historicalText: '凛は赤い鍵を持っていた。',
    retainedRevisionText: null,
    expectedExcerpt: CONTENT
  });
  const result = await runtime.stage(REQUEST);
  assert.equal(result.stagedCount, 1);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.historyReads, 2);
});

test('opt-in offline runtime completes one chunk and skips a second paid call', async () => {
  let row = null;
  const checkpointRepository = {
    async readSnapshot() {
      return row;
    },
    async compareAndSwap(change) {
      if (
        change.expectedRevision !== (row?.revision ?? null) ||
        change.expectedSourceHash !== (row?.source_hash ?? null)
      ) {
        return null;
      }
      row = {
        episode_id: 11,
        revision: (row?.revision ?? 0) + 1,
        source_hash: change.nextSourceHash,
        summary: change.nextSummary
      };
      return row;
    }
  };
  const { runtime, state } = fixture({
    checkpointEnabled: true,
    checkpointRepository
  });
  const first = await runtime.stage(REQUEST);
  assert.equal(first.stagedCount, 1);
  assert.equal(state.reservations, 1);
  assert.equal(state.modelCalls, 1);
  assert.equal(row.summary.novelightPhase2.state, 'complete');
  assert.match(row.source_hash, /^[a-f0-9]{64}$/u);
  const second = await runtime.stage(REQUEST);
  assert.deepEqual(second, {
    novelId: 41,
    stagedCount: 0,
    requiresAuthorReview: false
  });
  assert.equal(state.reservations, 1);
  assert.equal(state.modelCalls, 1);
});

test('owner trial can inspect the next chunk without reserving budget or AI calls', async () => {
  const { runtime, state } = fixture({ currentText: '青'.repeat(3100) });
  const result = await runtime.inspectPlan(REQUEST);
  assert.deepEqual(result, {
    novelId: 41,
    episodeId: 11,
    chunkCount: 3,
    nextChunkIndex: 0,
    status: 'ready'
  });
  assert.equal(state.modelCalls, 0);
  assert.equal(state.reservations, 0);
  assert.equal(state.settlements, 0);
  assert.equal(state.staged, 0);
  assert.equal(state.audits, 0);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('owner trial cannot inspect plans when disabled, unauthenticated or without consent', async () => {
  const disabled = fixture({ enabled: false });
  await assert.rejects(
    disabled.runtime.inspectPlan(REQUEST),
    /AI_TRIAL_RUNTIME_DISABLED/u
  );
  assert.equal(disabled.state.authorClients, 0);
  const other = fixture({ actor: OTHER });
  await assert.rejects(
    other.runtime.inspectPlan(REQUEST),
    /AI_TRIAL_RUNTIME_DENIED/u
  );
  assert.equal(other.state.authorClients, 0);
  const denied = fixture({ consent: false });
  await assert.rejects(
    denied.runtime.inspectPlan(REQUEST),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(denied.state.modelCalls, 0);
  assert.equal(denied.state.reservations, 0);
});

test('server stop before reserve blocks provider and candidate writes', async () => {
  const { runtime, state } = fixture({ runtimeEnabled: false });
  await assert.rejects(
    runtime.stage(REQUEST),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(state.reservations, 0);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.staged, 0);
});

test('server stop after atomic reserve settles zero and never calls provider', async () => {
  const { runtime, state } = fixture({
    onReserve(current) {
      current.runtimeEnabled = false;
    }
  });
  await assert.rejects(runtime.stage(REQUEST), /AI_ACCESS_DENIED/u);
  assert.equal(state.reservations, 1);
  assert.equal(state.settlements, 1);
  assert.deepEqual(state.settlementCharges, [0]);
  assert.equal(state.audits, 1);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.staged, 0);
});

test('server stop during model invocation settles once, then blocks review storage', async () => {
  const { runtime, state } = fixture({
    onModelCall(current) {
      current.runtimeEnabled = false;
    }
  });
  await assert.rejects(
    runtime.stage(REQUEST),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/u
  );
  assert.equal(state.reservations, 1);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.settlements, 1);
  assert.equal(state.audits, 1);
  assert.equal(state.staged, 0);
  assert.ok(state.settlementCharges[0] > 0);
});

test('revoked consent during atomic reserve also settles safely before sending text', async () => {
  const { runtime, state } = fixture({
    onReserve(current) {
      current.consent = false;
    }
  });
  await assert.rejects(runtime.stage(REQUEST), /AI_ACCESS_DENIED/u);
  assert.equal(state.reservations, 1);
  assert.equal(state.settlements, 1);
  assert.deepEqual(state.settlementCharges, [0]);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.staged, 0);
});
