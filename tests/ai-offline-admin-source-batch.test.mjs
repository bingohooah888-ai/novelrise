import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { prepareScreenFlow } from './helpers/ai-offline-screen-flow.mjs';
import {
  createOfflineAdminPolicyReader,
  projectAdminReviewedExcerpt
} from '../api/_lib/ai/offline-policy-review.js';
import { createOfflineAdminSelectionReader } from '../api/_lib/ai/offline-selection-review.js';
import {
  createOfflineAdminIncidentReader,
  createOfflineAdminKpiReader
} from '../api/_lib/ai/offline-aggregate-review.js';

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

test('reviewed source excludes private text and fails on drift', () => {
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
  test('canonical scoped policy: ' + feature, async () => {
    const { state, policy } = fixture();
    const selection =
      feature === 'comment-moderation'
        ? { commentId: COMMENT, ...reviewed }
        : { episodeId: '2', ...reviewed };
    const prepared = await prepareScreenFlow(
      'policy',
      policy,
      feature,
      selection,
      { req, res }
    );
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
    const checked = await prepared.review(response, policyQuote);
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

test('inquiry support uses reviewed ordinary passages', async () => {
  const { state, inquiry } = fixture();
  const feature = 'inquiry-assistant';
  const selection = { inquiryId: '3', ...reviewed };
  const prepared = await prepareScreenFlow(
    'selection',
    inquiry,
    feature,
    selection,
    { req, res }
  );
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
  const result = await prepared.review(response, 'posting');
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.category, 'posting');
  state.category = '個人情報の開示・利用目的通知';
  await assert.rejects(inquiry.review(feature, selection, req, res, response));
  state.category = '投稿・作品';
  state.inquiryStatus = 'resolved';
  await assert.rejects(inquiry.prepare(feature, selection, req, res));
});

test('incident counts recorded thumbnail failures', async () => {
  const { state, incident } = fixture();
  const selection = { days: 7 };
  const prepared = await prepareScreenFlow(
    'incident',
    incident,
    'error-log-summary',
    selection,
    { req, res }
  );
  const data = JSON.parse(prepared.prompt.user).untrusted_data;
  assert.deepEqual(data.counts, [
    { key: 'thumbnail-render:render_failed', count: 5 }
  ]);
  const response = {
    requestHash: prepared.requestHash,
    modelText: '{"keys":["thumbnail-render:render_failed"]}'
  };
  const result = await prepared.review(
    response,
    'thumbnail-render:render_failed'
  );
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

test('KPI uses adjacent complete JST windows', async () => {
  let value = 60;
  const calls = [];
  const reader = createOfflineAdminKpiReader({
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN },
    nowEpochSeconds: () => 1800000000,
    supabase: {
      auth: {
        async getUser() {
          return { data: { user: { id: ADMIN } } };
        }
      },
      from(table) {
        let column;
        let start;
        const query = {
          select(field, options) {
            column = field;
            assert.deepEqual(options, { count: 'exact', head: true });
            assert.equal(
              field,
              table === 'user_lifecycle' ? 'registered_at' : 'counted_at'
            );
            return query;
          },
          gte(field, date) {
            assert.equal(field, column);
            start = date;
            return query;
          },
          async lt(field, date) {
            assert.equal(field, column);
            calls.push({ table, start, end: date });
            return { count: value };
          }
        };
        return query;
      }
    }
  });
  const selection = { days: 7 };
  const prepared = await prepareScreenFlow(
    'kpi',
    reader,
    'kpi-anomaly',
    selection,
    { req, res }
  );
  const data = JSON.parse(prepared.prompt.user).untrusted_data;
  assert.deepEqual(data.rows, [
    { metric: 'newUsers', current: 60, previous: 60 },
    { metric: 'episodePageviews', current: 60, previous: 60 }
  ]);
  assert.equal(calls.length, 4);
  for (const table of ['user_lifecycle', 'episode_pv_events']) {
    const [previous, current] = calls
      .filter((row) => row.table === table)
      .sort((a, b) => a.start.localeCompare(b.start));
    assert.equal(previous.end, current.start);
    assert.equal(
      Date.parse(current.end) - Date.parse(current.start),
      7 * 86400000
    );
    assert.match(current.end, /T15:00:00\.000Z$/u);
  }
  const response = {
    requestHash: prepared.requestHash,
    modelText: '{"metrics":["newUsers"]}'
  };
  const checked = await prepared.review(response, 'newUsers');
  assert.equal(checked.statisticalAnomalyVerified, false);
  assert.equal(checked.scope, 'registrations_and_episode_pageviews_only');
  await assert.rejects(
    reader.review(selection, req, res, {
      ...response,
      modelText: '{"metrics":["uniqueVisitors"]}'
    })
  );
  value = 61;
  await assert.rejects(reader.review(selection, req, res, response));
  value = 1;
  await assert.rejects(reader.prepare(selection, req, res));
});
