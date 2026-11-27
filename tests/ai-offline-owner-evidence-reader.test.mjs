import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareScreenFlow } from './helpers/ai-offline-screen-flow.mjs';
import { createOfflineOwnerEvidenceReader } from '../api/_lib/ai/offline-evidence-review.js';
import { createOwnerNovelBibleAuthorClientFactory } from '../api/_lib/ai/owner-novel-bible-author-client.js';
import { createOfflineOwnerSessionCheck } from '../api/_lib/ai/owner-session-evidence.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'synthetic-owner-token-not-a-real-jwt';
const NOW = 1800000000;
const CONFIG = {
  id: OWNER,
  url: 'https://example.supabase.co',
  key: 'sb_publishable_offline_test_key'
};
const novel = {
  id: 1,
  user_id: OWNER,
  title: '王都',
  description: '鍵を探す旅',
  private_note: 'PRIVATE_NOTE'
};
const first = {
  id: 11,
  novel_id: 1,
  user_id: OWNER,
  episode_number: 1,
  status: 'draft',
  title: '門',
  content: '凛は青い鍵を見つけた。'
};
const second = {
  ...first,
  id: 12,
  episode_number: 2,
  title: '鍵',
  content: '凛は赤い鍵を見つけた。'
};
const citation = {
  episodeId: '11',
  offset: 0,
  quote: '凛は'
};
const otherCitation = { ...citation, episodeId: '12' };
const observation = '架空の確認候補';
const two = { novelId: 1, episodeIds: [11, 12] };
const one = { novelId: 1, episodeIds: [11] };
const pair = { first: citation, second: otherCitation, observation };

function fixture() {
  const state = {
    actor: OWNER,
    session: SESSION,
    active: true,
    now: NOW,
    novel: { ...novel },
    episodes: [
      { ...first },
      { ...second },
      { ...second, id: 13, content: 'UNSELECTED_BODY' }
    ],
    calls: [],
    error: null,
    bypassFilters: false,
    revokeAfterRead: false
  };
  const verifyUser = async (token) => {
    assert.equal(token, TOKEN);
    return { data: { user: { id: state.actor } }, error: null };
  };
  const checkSession = createOfflineOwnerSessionCheck({
    async verifySignedClaims(token) {
      assert.equal(token, TOKEN);
      return {
        data: {
          claims: {
            sub: state.actor,
            session_id: state.session,
            role: 'authenticated',
            aud: 'authenticated',
            iat: NOW - 60,
            exp: NOW + 120
          }
        },
        error: null
      };
    },
    async readExistingSession({ sessionId, actorId }) {
      const row = { id: sessionId, user_id: actorId };
      const data = state.active ? row : null;
      return { data, error: null };
    },
    nowEpochSeconds: () => state.now
  });
  const createAuthorClient = createOwnerNovelBibleAuthorClientFactory({
    config: CONFIG,
    createClientImpl(url, key, options) {
      assert.equal(url, CONFIG.url);
      assert.equal(key, CONFIG.key);
      assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
      return {
        auth: { getUser: verifyUser },
        async rpc() {
          assert.fail('unexpected RPC');
        },
        from(table) {
          const call = { table, columns: null, filters: [], limit: null };
          state.calls.push(call);
          const query = {
            select(columns) {
              call.columns = columns;
              return query;
            },
            eq(column, value) {
              call.filters.push([column, String(value)]);
              return query;
            },
            in(column, ids) {
              assert.equal(column, 'id');
              call.ids = ids;
              return query;
            },
            async maybeSingle() {
              assert.equal(table, 'novels');
              const data = state.novel ? { ...state.novel } : null;
              return { data, error: state.error };
            },
            async limit(value) {
              assert.equal(table, 'episodes');
              call.limit = value;
              const selected = (row) => call.ids.includes(String(row.id));
              let rows = state.episodes;
              if (!state.bypassFilters) rows = rows.filter(selected);
              if (state.revokeAfterRead) state.active = false;
              const data = rows.map((row) => ({ ...row }));
              return { data, error: state.error };
            }
          };
          return query;
        }
      };
    }
  });
  const reader = createOfflineOwnerEvidenceReader({
    verifyUser,
    createAuthorClient,
    checkSession,
    nowEpochSeconds: () => state.now
  });
  return { state, reader };
}

const cases = [
  {
    feature: 'work-analysis',
    selection: two,
    output: { items: [{ ...citation, kind: 'pacing', observation }] },
    kind: 'work_analysis_candidates'
  },
  {
    feature: 'character-consistency',
    selection: two,
    output: { items: [{ ...pair, kind: 'ability' }] },
    kind: 'character_consistency_candidates'
  },
  {
    feature: 'timeline-foreshadowing',
    selection: two,
    output: { items: [{ ...pair, kind: 'possible_payoff' }] },
    kind: 'timeline_foreshadowing_candidates'
  },
  {
    feature: 'writing-assistant',
    selection: one,
    output: { items: [{ ...citation, replacement: '凛は鍵を' }] },
    kind: 'proposed_edits'
  },
  {
    feature: 'prepublish-check',
    selection: one,
    output: { items: [{ ...citation, kind: 'spelling', observation }] },
    kind: 'prepublish_review_candidates'
  },
  {
    feature: 'promotion-assistant',
    selection: { ...two, format: 'intro50' },
    output: { items: [{ ...citation, draft: '鍵の物語' }] },
    kind: 'promotion_drafts'
  },
  {
    feature: 'virtual-beta-reader',
    selection: two,
    output: {
      items: ['pacing', 'character', 'clarity'].map((perspective) => ({
        ...citation,
        perspective,
        observation
      }))
    },
    kind: 'hypothetical_ai_review'
  },
  {
    feature: 'publishing-preparation',
    selection: two,
    output: { items: [{ ...citation, kind: 'character' }] },
    kind: 'publishing_source_outline'
  },
  {
    feature: 'title-synopsis-ab',
    selection: { novelId: 1 },
    output: { items: [{ title: '門の旅', description: '新しい鍵' }] },
    kind: 'metadata_drafts'
  }
];

async function mockTrial(reader, feature, selection, mock) {
  const prepared = await prepareScreenFlow(
    'owner',
    reader,
    feature,
    selection,
    { token: TOKEN }
  );
  const { prompt, requestHash } = prepared;
  const modelText = await mock(prompt);
  const item = JSON.parse(modelText).items[0];
  const expected = item.quote ?? item.first?.quote ?? item.title;
  return prepared.review({ requestHash, modelText }, expected);
}

for (const { feature, selection, output, kind } of cases) {
  test('owner source flow: ' + feature, async () => {
    const { state, reader } = fixture();
    const mock = async (prompt) => {
      assert.match(prompt.system, /untrusted/u);
      assert.doesNotMatch(prompt.user, /PRIVATE_NOTE|UNSELECTED_BODY/u);
      assert.ok(!prompt.user.includes(OWNER));
      assert.ok(!prompt.user.includes(TOKEN));
      const payload = JSON.parse(prompt.user).untrusted_work_context;
      if (feature === 'title-synopsis-ab') {
        assert.equal(payload.title, novel.title);
        assert.equal(payload.description, novel.description);
        assert.equal(payload.episodes, undefined);
      } else {
        assert.deepEqual(
          payload.episodes.map((row) => row.id),
          selection.episodeIds.map(String)
        );
      }
      return JSON.stringify(output);
    };
    const result = await mockTrial(reader, feature, selection, mock);
    assert.equal(result.kind, kind);
    const isNovel = (call) => call.table === 'novels';
    const isEpisode = (call) => call.table === 'episodes';
    const novelCalls = state.calls.filter(isNovel);
    const episodeCalls = state.calls.filter(isEpisode);
    assert.equal(novelCalls.length, 4);
    assert.equal(episodeCalls.length, selection.episodeIds ? 2 : 0);
    for (const call of novelCalls) {
      assert.equal(call.filters.length, 2);
      assert.deepEqual(call.filters[0], ['id', '1']);
      assert.deepEqual(call.filters[1], ['user_id', OWNER]);
    }
    for (const call of episodeCalls) {
      assert.equal(call.filters.length, 2);
      assert.deepEqual(call.filters[0], ['novel_id', '1']);
      assert.deepEqual(call.filters[1], ['user_id', OWNER]);
      assert.deepEqual(call.ids, selection.episodeIds.map(String));
      assert.equal(call.limit, selection.episodeIds.length + 1);
    }
  });
}

test('invalid selections fail before any source read', async () => {
  const { state, reader } = fixture();
  for (const selection of [
    { ...one, principal: { id: OWNER } },
    { ...one, episodes: [first] },
    { novelId: 1, episodeIds: [11, 11] },
    { novelId: 1, episodeIds: [] },
    { novelId: 1, episodeIds: [0] }
  ]) {
    await assert.rejects(reader.prepare('work-analysis', selection, TOKEN));
  }
  await assert.rejects(reader.prepare('writing-assistant', two, TOKEN));
  await assert.rejects(reader.prepare('spoiler-safe-recap', one, TOKEN));
  assert.equal(state.calls.length, 0);
});

test('denies missing ownership or session before read', async () => {
  const changes = [
    (state) => {
      state.actor = OTHER;
    },
    (state) => {
      state.active = false;
    },
    (state) => {
      state.novel.user_id = OTHER;
    },
    (state) => {
      state.novel = null;
    }
  ];
  for (const change of changes) {
    const { state, reader } = fixture();
    change(state);
    await assert.rejects(reader.prepare('work-analysis', one, TOKEN));
    assert.ok(state.calls.every((call) => call.table === 'novels'));
  }
});

test('denies bad episode rows and mid-read revocation', async () => {
  const changes = [
    (state) => {
      state.episodes[0].novel_id = 2;
    },
    (state) => {
      state.episodes[0].user_id = OTHER;
    },
    (state) => {
      state.episodes[0].status = 'unknown';
    },
    (state) => {
      state.bypassFilters = true;
    },
    (state) => {
      state.episodes = [];
    },
    (state) => {
      state.revokeAfterRead = true;
    }
  ];
  for (const change of changes) {
    const { state, reader } = fixture();
    change(state);
    await assert.rejects(reader.prepare('work-analysis', one, TOKEN));
  }
});

test('rejects stale responses and sanitizes failures', async () => {
  const item = { ...citation, kind: 'pacing', observation };
  const modelText = JSON.stringify({ items: [item] });
  const changes = [
    (state) => {
      state.episodes[0].content += '改訂';
    },
    (state) => {
      state.episodes[0].status = 'published';
    },
    (state) => {
      state.episodes[0].episode_number = 4;
    },
    (state) => {
      state.session = OTHER;
    },
    (state) => {
      state.active = false;
    },
    (state) => {
      state.now = NOW + 121;
    },
    (state) => {
      state.error = new Error('PRIVATE_TOKEN');
    }
  ];
  for (const change of changes) {
    const { state, reader } = fixture();
    const feature = 'work-analysis';
    const { requestHash } = await reader.prepare(feature, one, TOKEN);
    change(state);
    const response = { requestHash, modelText };
    const pending = reader.review(feature, one, TOKEN, response);
    await assert.rejects(pending, { message: 'AI_OFFLINE_EVIDENCE_INVALID' });
  }
});

test('rejects metadata revisions without manuscript reads', async () => {
  const { state, reader } = fixture();
  const feature = 'title-synopsis-ab';
  const selection = { novelId: 1 };
  const { requestHash } = await reader.prepare(feature, selection, TOKEN);
  state.novel.title = '改訂';
  const response = { requestHash, modelText: '{"items":[]}' };
  await assert.rejects(reader.review(feature, selection, TOKEN, response));
  assert.ok(state.calls.every((call) => call.table === 'novels'));
});
