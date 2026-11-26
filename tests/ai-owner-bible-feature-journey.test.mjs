// The real offline feature flow: manuscript -> Router mock -> validated
// suggestions -> review repository -> explicit author click. No live endpoint,
// provider, Supabase project, secret, or durable author-canon mutation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createAiRouter } from '../api/_lib/ai/router.js';
import { createOwnerBibleReviewWorkflow } from '../api/_lib/ai/owner-bible-review-workflow.js';
import { createOwnerNovelBibleModelBridge } from '../api/_lib/ai/owner-novel-bible-model-bridge.js';
import '../novelight-ai-bible-review-actions.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-session-bearer-only';
const CONTENT = '凛は青い鍵を持っていた。古い鐘が三回鳴った。';
const TITLE = '第一話';
const SOURCE_HASH = createHash('sha256')
  .update(JSON.stringify([TITLE, CONTENT]))
  .digest('hex');

const SUGGESTIONS = [
  {
    kind: 'character',
    key: '凛',
    summary: '青い鍵を持つ人物。',
    evidence: '凛は青い鍵を持っていた。'
  },
  {
    kind: 'foreshadowing',
    key: '古い鐘',
    summary: '鐘が三回鳴る描写。',
    evidence: '古い鐘が三回鳴った。'
  }
];

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.textContent = '';
    this.children = [];
    this.listeners = new Map();
    this.removed = false;
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  addEventListener(event, callback) {
    this.listeners.set(event, callback);
  }

  remove() {
    this.removed = true;
  }
}

function makeJourney({
  actor = OWNER,
  consent = true,
  budgetAllowed = true,
  modelSuggestions = SUGGESTIONS,
  afterProvider
} = {}) {
  const state = {
    actor,
    consent,
    budgetAllowed,
    modelSuggestions,
    episode: { id: 11, novel_id: 41, title: TITLE, content: CONTENT },
    confirmedCanon: [{ kind: 'character', key: '凛' }],
    pending: new Map(),
    batches: new Set(),
    modelCalls: 0,
    reservations: 0,
    settlements: 0,
    audits: 0,
    uiRequests: []
  };

  const authClient = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.actor } }, error: null };
      }
    }
  };

  const serviceClient = {
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
            return { data: { ...state.episode }, error: null };
          }
          throw new Error('Unexpected offline table');
        }
      };
    }
  };

  const repository = {
    async listAuthorConfirmed({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 41);
      return [...state.confirmedCanon];
    },
    async savePendingBatch(batch) {
      assert.equal(batch.actorId, OWNER);
      assert.equal(batch.novelId, 41);
      assert.equal(batch.sourceHash, SOURCE_HASH);
      if (state.batches.has(batch.requestHash)) return { count: 0 };
      state.batches.add(batch.requestHash);
      for (const candidate of batch.candidates) {
        const nextId = state.pending.size + 1;
        state.pending.set(nextId, {
          id: nextId,
          actorId: OWNER,
          novelId: 41,
          sourceEpisodeId: 11,
          sourceHash: batch.sourceHash,
          factKind: candidate.factKind,
          factKey: candidate.factKey,
          summary: candidate.factPayload.summary,
          evidence: candidate.factPayload.evidence,
          provenance: 'ai_inferred',
          status: 'pending',
          revision: 1
        });
      }
      return { count: batch.candidates.length };
    },
    async listPending({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 41);
      return [...state.pending.values()]
        .filter((row) => row.status === 'pending')
        .map((row) => ({ ...row }));
    },
    async readCandidate({ actorId, novelId, candidateId }) {
      const row = state.pending.get(candidateId);
      return row?.actorId === actorId && row.novelId === novelId
        ? { ...row }
        : null;
    },
    async compareAndSwapDecision({
      actorId,
      novelId,
      candidateId,
      sourceHash,
      expectedRevision,
      expectedStatus,
      decision
    }) {
      const row = state.pending.get(candidateId);
      if (
        !row ||
        row.actorId !== actorId ||
        row.novelId !== novelId ||
        row.sourceHash !== sourceHash ||
        row.revision !== expectedRevision ||
        row.status !== expectedStatus
      ) {
        return null;
      }
      row.status = decision;
      row.revision += 1;
      return { status: row.status, revision: row.revision };
    }
  };

  const workflow = createOwnerBibleReviewWorkflow({
    enabled: true,
    ownerId: OWNER,
    authClient,
    serviceClient,
    repository
  });

  const router = createAiRouter({
    enabled: true,
    authorize: async ({ principal, feature, workId }) =>
      principal.id === OWNER && feature.key === 'novel-bible' && workId === 41,
    budget: {
      async reserve() {
        state.reservations += 1;
        return state.budgetAllowed ? { id: 'synthetic-reservation' } : null;
      },
      async settle() {
        state.settlements += 1;
      }
    },
    audit: {
      async record() {
        state.audits += 1;
      }
    },
    providers: {
      local: {
        async generate({ model, system, user }) {
          state.modelCalls += 1;
          assert.equal(model, 'offline-mock');
          assert.match(system, /untrusted data/);
          const parsed = JSON.parse(user);
          assert.equal(parsed.untrusted_excerpt, CONTENT);
          assert.equal(
            parsed.task,
            'Extract review candidates from this excerpt only'
          );
          if (afterProvider) afterProvider(state);
          return {
            text: JSON.stringify({ suggestions: state.modelSuggestions }),
            usage: { inputTokens: 30, outputTokens: 40 }
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

  const bridge = createOwnerNovelBibleModelBridge({
    enabled: true,
    externalProcessingApproved: true, // Local injected mock only.
    ownerId: OWNER,
    authClient,
    serviceClient,
    aiRouter: router,
    reviewWorkflow: workflow,
    permissionCheck: async ({ actorId, novelId, episodeId, purpose }) =>
      state.consent &&
      actorId === OWNER &&
      novelId === 41 &&
      episodeId === 11 &&
      purpose === 'external-novel-bible-analysis'
  });

  let signedIn = true;
  const uiSession = () =>
    signedIn ? { user: { id: state.actor }, access_token: TOKEN } : null;
  let authEvent = null;
  const client = {
    auth: {
      async getSession() {
        return { data: { session: uiSession() }, error: null };
      },
      onAuthStateChange(callback) {
        authEvent = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  const root = new Element('main');
  const doc = {
    getElementById(id) {
      assert.equal(id, 'main-content');
      return root;
    },
    createElement(name) {
      return new Element(name);
    }
  };
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/ai-owner-bible-review?novel_id=41');
    state.uiRequests.push(options.method);
    if (options.method === 'GET') {
      const data = await workflow.list({ token: TOKEN, novelId: 41 });
      return {
        ok: true,
        async json() {
          return data;
        }
      };
    }
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Novelight-Review'], '1');
    const body = JSON.parse(options.body);
    const data = await workflow.decide({
      token: TOKEN,
      novelId: 41,
      ...body,
      explicitAuthorAction: true
    });
    return {
      ok: true,
      async json() {
        return data;
      }
    };
  };

  return {
    state,
    bridge,
    workflow,
    root,
    async attachReviewUi() {
      return globalThis.NovelightAiBibleReviewActions.attach({
        client,
        doc,
        novelId: 41,
        ownerId: OWNER,
        fetcher
      });
    },
    signOut() {
      signedIn = false;
      authEvent?.('SIGNED_OUT', null);
    }
  };
}

const request = { token: TOKEN, novelId: 41, episodeId: 11 };

test('full offline journey: excerpt -> model -> evidence -> pending -> explicit accept and reject', async () => {
  const journey = makeJourney();
  const result = await journey.bridge.stage(request);
  assert.deepEqual(result, {
    novelId: 41,
    stagedCount: 2,
    requiresAuthorReview: true
  });
  assert.equal(journey.state.modelCalls, 1);
  assert.equal(journey.state.reservations, 1);
  assert.equal(journey.state.settlements, 1);
  assert.equal(journey.state.audits, 1);
  assert.equal(journey.state.pending.get(1).sourceHash, SOURCE_HASH);
  assert.equal(journey.state.pending.get(2).status, 'pending');
  assert.equal(journey.state.confirmedCanon.length, 1);

  assert.equal(await journey.attachReviewUi(), true);
  assert.deepEqual(journey.state.uiRequests, ['GET']);
  const section = journey.root.children[0];
  assert.match(
    section.children[2].textContent,
    /正式な人物台帳・創作ノートには自動反映されません/
  );
  const list = section.children[1];
  assert.equal(list.children.length, 2);
  assert.match(
    list.children[0].children[0].textContent,
    /本文根拠：凛は青い鍵を持っていた/
  );
  assert.match(list.children[1].children[0].textContent, /古い鐘/);
  assert.match(list.children[0].children[1].textContent, /正式設定は未変更/);
  assert.equal(journey.state.uiRequests.length, 1);

  await list.children[0].children[1].listeners.get('click')();
  assert.equal(journey.state.pending.get(1).status, 'accepted');
  assert.equal(journey.state.pending.get(1).revision, 2);
  assert.equal(list.children[0].removed, true);
  assert.match(
    section.children[2].textContent,
    /正式設定は作者が別途編集してください/
  );
  assert.deepEqual(journey.state.confirmedCanon, [
    { kind: 'character', key: '凛' }
  ]);

  await list.children[1].children[2].listeners.get('click')();
  assert.equal(journey.state.pending.get(2).status, 'rejected');
  assert.deepEqual(journey.state.uiRequests, ['GET', 'POST', 'POST']);
  assert.equal(
    (await journey.workflow.list({ token: TOKEN, novelId: 41 })).candidates
      .length,
    0
  );
  await assert.rejects(
    journey.workflow.decide({
      token: TOKEN,
      novelId: 41,
      candidateId: 1,
      expectedRevision: 1,
      action: 'accept',
      explicitAuthorAction: true
    }),
    /AI_OWNER_REVIEW_DENIED/
  );
  journey.signOut();
  assert.equal(section.removed, true);
});

test('invalid quote or malicious model fields cannot create pending records', async () => {
  for (const suggestions of [
    [{ ...SUGGESTIONS[0], evidence: '実際の本文にない引用' }],
    [{ ...SUGGESTIONS[0], status: 'author_confirmed' }],
    [
      {
        ...SUGGESTIONS[0],
        key: '<script>author</script>',
        evidence: '存在しない引用'
      }
    ]
  ]) {
    const { bridge, state } = makeJourney({ modelSuggestions: suggestions });
    await assert.rejects(bridge.stage(request), /AI_BIBLE_INFERENCE_INVALID/);
    assert.equal(state.pending.size, 0);
    assert.equal(state.confirmedCanon.length, 1);
  }
});

test('refused consent and zero budget stop before the simulated provider', async () => {
  const denied = makeJourney({ consent: false });
  await assert.rejects(
    denied.bridge.stage(request),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/
  );
  assert.equal(denied.state.modelCalls, 0);
  assert.equal(denied.state.reservations, 0);

  const noBudget = makeJourney({ budgetAllowed: false });
  await assert.rejects(noBudget.bridge.stage(request), /AI_BUDGET_DENIED/);
  assert.equal(noBudget.state.modelCalls, 0);
  assert.equal(noBudget.state.pending.size, 0);
});

test('revoked consent or changed manuscript after mock generation prevents persistence', async () => {
  const revoked = makeJourney({
    afterProvider(state) {
      state.consent = false;
    }
  });
  await assert.rejects(
    revoked.bridge.stage(request),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/
  );
  assert.equal(revoked.state.pending.size, 0);

  const changed = makeJourney({
    afterProvider(state) {
      state.episode.content += '後から修正された本文。';
    }
  });
  await assert.rejects(changed.bridge.stage(request), /AI_BIBLE_CHUNK_INVALID/);
  assert.equal(changed.state.pending.size, 0);
});

test('non-owner identity cannot reach the provider or author controls', async () => {
  const journey = makeJourney({ actor: OTHER });
  await assert.rejects(
    journey.bridge.stage(request),
    /AI_BIBLE_MODEL_BRIDGE_DENIED/
  );
  assert.equal(journey.state.modelCalls, 0);
  assert.equal(await journey.attachReviewUi(), false);
  assert.equal(journey.root.children.length, 0);
});
