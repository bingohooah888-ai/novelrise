import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareScreenFlow } from './helpers/ai-offline-screen-flow.mjs';
import {
  createOfflineAdminSelectionReader,
  loadOfflineOfficialThumbnail
} from '../api/_lib/ai/offline-selection-review.js';
import { createOfflineOwnerEvidenceReader } from '../api/_lib/ai/offline-evidence-review.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-token-not-a-real-jwt';
const req = { headers: { authorization: 'Bearer ' + TOKEN } };
const res = {
  setHeader() {},
  status() {
    return res;
  },
  json() {}
};

function fixture() {
  const state = {
    actor: OWNER,
    owner: OWNER,
    session: true,
    status: 'published',
    rating: 'general',
    description: '王国の冒険',
    templateRevision: 1,
    invalidGeometry: false,
    cover: true,
    assetStatus: 'active',
    reads: 0
  };
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: state.actor } } };
      }
    },
    from(table) {
      state.reads++;
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        async maybeSingle() {
          if (table === 'novels') {
            return {
              data: {
                id: 1,
                user_id: state.owner,
                title: '王国',
                description: state.description,
                genre: 'その他',
                status: state.status,
                content_rating: state.rating
              }
            };
          }
          assert.equal(table, 'novel_thumbnail_templates');
          return {
            data: {
              template_key: 'book-v1',
              availability_status: 'active',
              canvas_width: 1086,
              canvas_height: 1448,
              cover_quad_space: 'canvas',
              cover_mask_source: 'cover_quad',
              cover_mask_url: 'PRIVATE_MASK_URL',
              cover_mask_revision: state.templateRevision,
              cover_top_left_x: 120,
              cover_top_left_y: 160,
              cover_top_right_x: 930,
              cover_top_right_y: 250,
              cover_bottom_right_x: 850,
              cover_bottom_right_y: 1120,
              cover_bottom_left_x: state.invalidGeometry ? 120 : 180,
              cover_bottom_left_y: state.invalidGeometry ? 160 : 1030
            }
          };
        },
        async limit(limit) {
          assert.equal(limit, 301);
          assert.equal(table, 'novel_thumbnail_assets');
          const types = ['background', 'base_book', 'symbol'];
          if (state.cover) types.push('cover');
          return {
            data: types.map((layer, index) => ({
              id: 'asset-' + index,
              template_key: 'book-v1',
              layer_type: layer,
              availability_status: state.assetStatus,
              label: layer === 'cover' ? 'INTERNAL_COVER' : '黄金 ' + layer
            }))
          };
        }
      };
      return query;
    }
  };
  const admin = createOfflineAdminSelectionReader({
    supabase: client,
    env: { NOVELIGHT_ADMIN_USER_IDS: OWNER }
  });
  const author = createOfflineOwnerEvidenceReader({
    async verifyUser() {
      return { data: { user: { id: OWNER } } };
    },
    async createAuthorClient() {
      return client;
    },
    async checkSession() {
      return { active: state.session, binding: 'synthetic-session' };
    },
    nowEpochSeconds: () => 1800000000
  });
  return { state, client, admin, author };
}

test('FAQ reads canonical bundled help and rejects unauthorized queries', async () => {
  const { state, admin } = fixture();
  const feature = 'official-faq-assistant';
  const selection = { query: '予約公開' };
  const prepared = await prepareScreenFlow(
    'selection',
    admin,
    feature,
    selection,
    { req, res }
  );
  const catalog = JSON.parse(prepared.prompt.user).untrusted_data.topics;
  const publishing = catalog.find((row) => row.key === 'publishing');
  assert.ok(publishing);
  const response = {
    requestHash: prepared.requestHash,
    modelText: JSON.stringify({
      items: [{ key: 'publishing', part: 'summary', index: 0 }]
    })
  };
  const reviewed = await prepared.review(response, publishing.summary);
  assert.equal(reviewed.items[0].quote, publishing.summary);
  assert.equal(reviewed.items[0].href, 'help.html#publishing');
  await assert.rejects(
    admin.prepare(feature, { ...selection, topics: [] }, req, res)
  );
  state.actor = OTHER;
  await assert.rejects(admin.review(feature, selection, req, res, response));
});

test('classification only uses current published general metadata and editor genres', async () => {
  const { state, admin } = fixture();
  const feature = 'classification-anomaly';
  const selection = { novelId: '1' };
  const prepared = await prepareScreenFlow(
    'selection',
    admin,
    feature,
    selection,
    { req, res }
  );
  const data = JSON.parse(prepared.prompt.user).untrusted_data;
  assert.ok(data.genres.includes('異世界ファンタジー'));
  assert.equal(data.genres.length, 10);
  const response = {
    requestHash: prepared.requestHash,
    modelText: JSON.stringify({
      items: [
        {
          genre: '異世界ファンタジー',
          field: 'description',
          quote: '王国'
        }
      ]
    })
  };
  const result = await prepared.review(response, '異世界ファンタジー');
  assert.equal(result.requiresHumanReview, true);
  state.description = '別の説明';
  await assert.rejects(admin.review(feature, selection, req, res, response));
  state.status = 'draft';
  await assert.rejects(admin.prepare(feature, selection, req, res));
  state.status = 'published';
  state.rating = 'sensitive_15';
  await assert.rejects(admin.prepare(feature, selection, req, res));
});

test('official thumbnail reuses geometry, binds owner and current assets', async () => {
  const { state, client, author } = fixture();
  const feature = 'thumbnail-coordinator';
  const selection = { novelId: 1, templateKey: 'book-v1', theme: '黄金' };
  const prepared = await prepareScreenFlow(
    'owner',
    author,
    feature,
    selection,
    { token: TOKEN }
  );
  assert.match(prepared.prompt.user, /黄金 background/u);
  assert.doesNotMatch(prepared.prompt.user, /PRIVATE_MASK_URL|INTERNAL_COVER/u);
  const response = {
    requestHash: prepared.requestHash,
    modelText: JSON.stringify({
      templateKey: 'book-v1',
      selections: [
        { layer: 'background', assetId: 'asset-0' },
        { layer: 'base_book', assetId: 'asset-1' }
      ]
    })
  };
  const result = await prepared.review(response, 'asset-0');
  assert.equal(result.selections.length, 2);
  state.templateRevision++;
  await assert.rejects(author.review(feature, selection, TOKEN, response));
  state.invalidGeometry = true;
  await assert.rejects(loadOfflineOfficialThumbnail(client, 'book-v1'));
  state.invalidGeometry = false;
  state.cover = false;
  await assert.rejects(author.prepare(feature, selection, TOKEN));
  state.cover = true;
  state.assetStatus = 'retired';
  await assert.rejects(author.prepare(feature, selection, TOKEN));
  state.assetStatus = 'active';
  state.owner = OTHER;
  await assert.rejects(author.prepare(feature, selection, TOKEN));
  state.owner = OWNER;
  state.session = false;
  await assert.rejects(author.prepare(feature, selection, TOKEN));
});
