import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareScreenFlow } from './helpers/ai-offline-screen-flow.mjs';
import { createOfflineReaderSelectionReader } from '../api/_lib/ai/offline-selection-review.js';

const TOKEN = 'synthetic-reader-token-not-a-real-jwt';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const selection = {
  query: '冒険',
  genre: '異世界ファンタジー',
  tagIds: ['adventure']
};

function fixture() {
  const state = {
    actor: ACTOR,
    anonymous: false,
    hidden: ['3'],
    missing: ['5'],
    rating: 'general',
    tagMismatch: false,
    revoked: false,
    calls: [],
    authCalls: 0
  };
  const candidates = ['2', '3', '1', '4', '5'].map((id) => ({
    novel_id: id,
    title: '作品' + id,
    description: '冒険 ' + id,
    genre: '異世界ファンタジー',
    official_tag_ids: ['adventure'],
    official_tag_names: ['冒険'],
    custom_tag_names: ['旅'],
    author_name: 'PRIVATE_AUTHOR'
  }));
  const reader = createOfflineReaderSelectionReader({
    async createReaderClient({ token }) {
      assert.equal(token, TOKEN);
      return {
        auth: {
          async getUser(value) {
            assert.equal(value, TOKEN);
            state.authCalls++;
            if (state.revoked && state.authCalls % 2 === 0) {
              return { error: 'revoked' };
            }
            return {
              data: {
                user: { id: state.actor, is_anonymous: state.anonymous }
              }
            };
          }
        },
        async rpc(name, args) {
          state.calls.push(name);
          if (name === 'novelight_neutral_search_v2') {
            assert.equal(args.p_sort, 'new');
            assert.equal(args.p_limit, 24);
            assert.equal(args.p_offset, 0);
            return { data: candidates };
          }
          assert.deepEqual(args.p_novel_ids, ['2', '3', '1', '4', '5']);
          if (name === 'novelight_hidden_novel_ids') {
            return { data: state.hidden };
          }
          assert.equal(name, 'novelight_search_card_metadata');
          return {
            data: candidates
              .filter((row) => !state.missing.includes(row.novel_id))
              .reverse()
              .map((row) => ({
                novel_id: row.novel_id,
                content_rating:
                  row.novel_id === '4' ? 'sensitive_15' : state.rating,
                official_tag_names: state.tagMismatch ? ['別'] : ['冒険'],
                custom_tag_names: ['旅'],
                author_name: 'PRIVATE_AUTHOR'
              }))
          };
        }
      };
    }
  });
  return { state, reader };
}

for (const feature of ['natural-search-ai', 'discovery-assistant']) {
  test('reader source scope and rank: ' + feature, async () => {
    const { state, reader } = fixture();
    const request =
      feature === 'natural-search-ai' ? selection : { query: '冒険' };
    const prepared = await prepareScreenFlow(
      'reader',
      reader,
      feature,
      request,
      { token: TOKEN }
    );
    const data = JSON.parse(prepared.prompt.user).untrusted_data;
    assert.deepEqual(
      data.rows.map((row) => row.novelId),
      ['2', '1']
    );
    assert.doesNotMatch(prepared.prompt.user, /PRIVATE_AUTHOR/u);
    assert.doesNotMatch(prepared.prompt.user, /作品[345]/u);
    assert.doesNotMatch(prepared.prompt.user, /synthetic-reader-token/u);
    const response = {
      requestHash: prepared.requestHash,
      modelText: JSON.stringify({
        items: [
          { novelId: '1', field: 'tag', quote: '旅' },
          { novelId: '2', field: 'description', quote: '冒険' }
        ]
      })
    };
    const result = await prepared.review(response, '作品2');
    assert.deepEqual(
      result.items.map((row) => row.novelId),
      ['2', '1']
    );
    assert.equal(state.calls.length, 6);
    const injection = {
      ...response,
      modelText: '{"items":[{"novelId":"3","field":"tag","quote":"旅"}]}'
    };
    await assert.rejects(reader.review(feature, request, TOKEN, injection));
    state.hidden.push('2');
    await assert.rejects(reader.review(feature, request, TOKEN, response));
  });
}

test('reader source fails closed on identity, tags and missing eligibility', async () => {
  const { state, reader } = fixture();
  const feature = 'natural-search-ai';
  const prepared = await reader.prepare(feature, selection, TOKEN);
  const response = {
    requestHash: prepared.requestHash,
    modelText: '{"items":[]}'
  };
  state.actor = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(reader.review(feature, selection, TOKEN, response));
  state.actor = ACTOR;
  state.tagMismatch = true;
  await assert.rejects(reader.prepare(feature, selection, TOKEN));
  state.tagMismatch = false;
  state.rating = 'adult_18_nonsexual';
  await assert.rejects(reader.prepare(feature, selection, TOKEN));
  state.rating = 'general';
  state.anonymous = true;
  await assert.rejects(reader.prepare(feature, selection, TOKEN));
  state.anonymous = false;
  state.revoked = true;
  state.authCalls = 0;
  await assert.rejects(reader.prepare(feature, selection, TOKEN));
  await assert.rejects(
    reader.prepare(feature, { ...selection, rows: [] }, TOKEN)
  );
});
