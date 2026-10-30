// Phase 02-07-04: offline integration across the real Router, review
// workflow and dormant owner-only bridge. Never contacts an AI provider or DB.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiRouter } from '../api/_lib/ai/router.js';
import { createOwnerBibleReviewWorkflow } from '../api/_lib/ai/owner-bible-review-workflow.js';
import { createOwnerNovelBibleModelBridge } from '../api/_lib/ai/owner-novel-bible-model-bridge.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic.test.bearer-not-a-real-jwt';
const CONTENT = '凛は青い鍵を持っていた。';

function fixture({
  actorId = OWNER,
  consent = true,
  budgetAllowed = true,
  content = CONTENT,
  modelEvidence = null,
  onModelCall = null
} = {}) {
  const state = {
    actorId,
    consent,
    content,
    modelCalls: 0,
    reservations: [],
    settlements: [],
    audits: [],
    pending: [],
    prompts: []
  };
  const authClient = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.actorId } }, error: null };
      }
    }
  };
  const serviceClient = {
    ...authClient,
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
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
                content: state.content
              },
              error: null
            };
          }
          throw new Error('Unexpected mock table');
        }
      };
    }
  };
  const repository = {
    async listAuthorConfirmed() {
      return [];
    },
    async savePendingBatch(batch) {
      state.pending.push(batch);
      return { count: batch.candidates.length };
    },
    async readCandidate() {
      throw new Error('No candidate decisions in this offline test');
    },
    async compareAndSwapDecision() {
      throw new Error('No candidate decisions in this offline test');
    }
  };
  const router = createAiRouter({
    enabled: true,
    authorize: async ({ principal, feature, workId }) =>
      principal.id === OWNER && feature.key === 'novel-bible' && workId === 41,
    budget: {
      async reserve(input) {
        state.reservations.push(input);
        return budgetAllowed ? { id: 'synthetic-reservation' } : null;
      },
      async settle(input) {
        state.settlements.push(input);
      }
    },
    audit: {
      async record(input) {
        state.audits.push(input);
      }
    },
    providers: {
      local: {
        async generate({ model, system, user }) {
          state.modelCalls += 1;
          assert.equal(model, 'offline-mock');
          assert.match(system, /untrusted data/u);
          const excerpt = JSON.parse(user).untrusted_excerpt;
          state.prompts.push(excerpt);
          if (onModelCall) onModelCall(state);
          return {
            text: JSON.stringify({
              suggestions: [
                {
                  kind: 'character',
                  key: '凛',
                  summary: '青い鍵についての設定候補。',
                  evidence: modelEvidence ?? excerpt.slice(0, 9)
                }
              ]
            }),
            usage: { inputTokens: 25, outputTokens: 40 }
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
  const reviewWorkflow = createOwnerBibleReviewWorkflow({
    enabled: true,
    ownerId: OWNER,
    authClient,
    serviceClient,
    repository
  });
  const bridge = createOwnerNovelBibleModelBridge({
    enabled: true,
    externalProcessingApproved: true,
    ownerId: OWNER,
    authClient,
    serviceClient,
    aiRouter: router,
    reviewWorkflow,
    permissionCheck: async () => state.consent
  });
  return { state, bridge };
}

const request = { token: TOKEN, novelId: 41, episodeId: 11 };

test('offline real Router to owner review stages only evidence-backed pending facts', async () => {
  const { state, bridge } = fixture();
  const response = await bridge.stage(request);
  assert.deepEqual(response, {
    novelId: 41,
    stagedCount: 1,
    requiresAuthorReview: true
  });
  assert.equal(state.modelCalls, 1);
  assert.equal(state.reservations.length, 1);
  assert.ok(state.reservations[0].ceilingMicros > 0);
  assert.equal(state.settlements.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].outcome, 'success');
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].candidates[0].provenance, 'ai_inferred');
  assert.equal(state.pending[0].candidates[0].requiresAuthorReview, true);
  assert.ok(!JSON.stringify(response).includes(CONTENT));
  assert.ok(!JSON.stringify(response).includes(TOKEN));
});

test('zero-budget refusal prevents all provider and candidate calls', async () => {
  const { state, bridge } = fixture({ budgetAllowed: false });
  await assert.rejects(bridge.stage(request), /AI_BUDGET_DENIED/u);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.pending.length, 0);
  assert.equal(state.settlements.length, 0);
});

test('fabricated provider evidence bills once but cannot be staged', async () => {
  const { state, bridge } = fixture({
    modelEvidence: '本文に存在しない引用'
  });
  await assert.rejects(bridge.stage(request), /AI_BIBLE_INFERENCE_INVALID/u);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.settlements.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.pending.length, 0);
});

test('consent revocation after the provider call blocks persistence', async () => {
  const { state, bridge } = fixture({
    onModelCall(current) {
      current.consent = false;
    }
  });
  await assert.rejects(bridge.stage(request), /AI_BIBLE_MODEL_BRIDGE_DENIED/u);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.settlements.length, 1);
  assert.equal(state.pending.length, 0);
});

test('non-owner authentication is rejected before cost reservation', async () => {
  const { state, bridge } = fixture({ actorId: OTHER });
  await assert.rejects(bridge.stage(request), /AI_BIBLE_MODEL_BRIDGE_DENIED/u);
  assert.equal(state.modelCalls, 0);
  assert.equal(state.reservations.length, 0);
  assert.equal(state.pending.length, 0);
});

test('a later long-chapter chunk uses only its own excerpt', async () => {
  const { state, bridge } = fixture({
    content: '前'.repeat(1450) + '後'.repeat(1450),
    modelEvidence: '後後'
  });
  const response = await bridge.stage({ ...request, chunkIndex: 1 });
  assert.equal(response.stagedCount, 1);
  assert.equal(state.prompts.length, 1);
  assert.ok(Buffer.byteLength(state.prompts[0], 'utf8') <= 4096);
  assert.ok(state.prompts[0].includes('後後'));
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].candidates[0].factPayload.evidence, '後後');
});
