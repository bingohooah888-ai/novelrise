import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createOfflineAdminPolicyReader,
  projectAdminReviewedExcerpt
} from '../api/_lib/ai/offline-policy-review.js';
import { createOfflineAdminSelectionReader } from '../api/_lib/ai/offline-selection-review.js';
import { createOfflineAdminIncidentReader } from '../api/_lib/ai/offline-aggregate-review.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const COMMENT = '33333333-3333-4333-8333-333333333333';
const body = '架空の確認対象。private@example.test';
const safe = '架空の確認対象。';
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reviewed = {
  reviewedBodyHash: digest(body),
  ranges: [{ offset: 0, length: safe.length }],
  privacyReviewed: true
};
const req = { headers: { authorization: 'Bearer synthetic-admin-token' } };
const res = {
  setHeader() {},
  status() {
    return res;
  },
  json() {}
};

function fixture() {
  const state = {
    admin: ADMIN,
    body,
    status: 'published',
    rating: 'general',
    deleted: null,
    hidden: null,
    category: '投稿・作品',
    inquiryStatus: 'new',
    count: 5,
    epoch: 1800000000,
    calls: []
  };
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: state.admin } } };
      }
    },
    from(table) {
      state.calls.push(table);
      const query = {
        select(columns, options) {
          assert.doesNotMatch(columns, /email|user_id|error_message/u);
          if (table === 'thumbnail_render_failures') {
            assert.deepEqual(options, { count: 'exact', head: true });
          }
          return query;
        },
        eq() {
          return query;
        },
        gte(field) {
          assert.equal(field, 'created_at');
          return query;
        },
        async lt(field) {
          assert.equal(field, 'created_at');
          return { count: state.count };
        },
        async maybeSingle() {
          const rows = {
            novels: {
              id: 1,
              status: state.status,
              content_rating: state.rating
            },
            novel_comments: {
              id: COMMENT,
              novel_id: 1,
              body: state.body,
              deleted_at: state.deleted,
              author_hidden_at: state.hidden
            },
            episodes: {
              id: 2,
              novel_id: 1,
              content: state.body,
              status: state.status,
              scheduled_publish_at: null
            },
            contact_inquiries: {
              id: 3,
              message: state.body,
              category: state.category,
              status: state.inquiryStatus
            }
          };
          assert.ok(rows[table]);
          return { data: rows[table] };
        }
      };
      return query;
    }
  };
  const dependencies = {
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  };
  return {
    state,
    policy: createOfflineAdminPolicyReader(dependencies),
    inquiry: createOfflineAdminSelectionReader(dependencies),
    incident: createOfflineAdminIncidentReader({
      ...dependencies,
      nowEpochSeconds: () => state.epoch
    })
  };
}

test('human reviewed source excludes unselected content and fails on drift', () => {
  assert.equal(projectAdminReviewedExcerpt(body, reviewed), safe);
  assert.throws(() =>
    projectAdminReviewedExcerpt(body, { ...reviewed, privacyReviewed: false })
  );
  assert.throws(() => projectAdminReviewedExcerpt(body + '変更', reviewed));
  assert.throws(() =>
    projectAdminReviewedExcerpt(body, {
      ...reviewed,
      ranges: [{ offset: 0, length: body.length }]
    })
  );
});

for (const feature of ['comment-moderation', 'policy-risk-review']) {
  test('policy source is canonical, scoped and advisory: ' + feature, async () => {
    const { state, policy } = fixture();
    const selection =
      feature === 'comment-moderation'
        ? { commentId: COMMENT, ...reviewed }
        : { episodeId: '2', ...reviewed };
    const prepared = await policy.prepare(feature, selection, req, res);
    const data = JSON.parse(prepared.prompt.user).untrusted_data;
    assert.equal(data.body, safe);
    assert.equal(data.policy.length, 9);
    const policyQuote = '区分の意図的な虚偽申告は禁止します。';
    assert.ok(data.policy[4].body.includes(policyQuote));
    assert.doesNotMatch(prepared.prompt.user, /private@example/u);
    const response = {
      requestHash: prepared.requestHash,
      modelText: JSON.stringify({
        items: [
          {
            section: '5',
            policyQuote,
            offset: 0,
            quote: '架空'
          }
        ]
      })
    };
    const checked = await policy.review(feature, selection, req, res, response);
    assert.equal(checked.requiresHumanReview, true);
    assert.equal(checked.violationVerified, false);
    assert.equal(checked.scope, 'human_reviewed_excerpt');
    state.body += '変更';
    await assert.rejects(policy.review(feature, selection, req, res, response));
    state.body = body;
    state.rating = 'sensitive_15';
    await assert.rejects(policy.prepare(feature, selection, req, res));
    state.rating = 'general';
    state.hidden = '2026-11-01';
    if (feature === 'comment-moderation') {
      await assert.rejects(policy.prepare(feature, selection, req, res));
    }
  });
}

test('inquiry support reads only human-reviewed ordinary support passages', async () => {
  const { state, inquiry } = fixture();
  const feature = 'inquiry-assistant';
  const selection = { inquiryId: '3', ...reviewed };
  const prepared = await inquiry.prepare(feature, selection, req, res);
  const data = JSON.parse(prepared.prompt.user).untrusted_data;
  assert.equal(data.redactedBody, safe);
  assert.ok(data.categories.includes('posting'));
  assert.doesNotMatch(prepared.prompt.user, /private@example/u);
  const response = {
    requestHash: prepared.requestHash,
    modelText: JSON.stringify({
      category: 'posting',
      items: [{ key: 'publishing', part: 'summary', index: 0 }]
    })
  };
  const result = await inquiry.review(feature, selection, req, res, response);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.category, 'posting');
  state.category = '個人情報の開示・利用目的通知';
  await assert.rejects(inquiry.review(feature, selection, req, res, response));
  state.category = '投稿・作品';
  state.inquiryStatus = 'resolved';
  await assert.rejects(inquiry.prepare(feature, selection, req, res));
});

test('incident reader counts only recorded thumbnail failure rows', async () => {
  const { state, incident } = fixture();
  const selection = { days: 7 };
  const prepared = await incident.prepare(selection, req, res);
  const data = JSON.parse(prepared.prompt.user).untrusted_data;
  assert.deepEqual(data.counts, [
    { key: 'thumbnail-render:render_failed', count: 5 }
  ]);
  const response = {
    requestHash: prepared.requestHash,
    modelText: '{"keys":["thumbnail-render:render_failed"]}'
  };
  const result = await incident.review(selection, req, res, response);
  assert.equal(result.scope, 'recorded_thumbnail_failures_only');
  assert.equal(result.rootCauseVerified, false);
  state.count++;
  await assert.rejects(incident.review(selection, req, res, response));
  state.count = null;
  await assert.rejects(incident.prepare(selection, req, res));
  state.count = 5;
  state.admin = COMMENT;
  await assert.rejects(incident.prepare(selection, req, res));
});
