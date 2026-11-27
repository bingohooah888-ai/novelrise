import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareScreenFlow } from './helpers/ai-offline-screen-flow.mjs';
import { createOfflineOwnerEvidenceReader } from '../api/_lib/ai/offline-evidence-review.js';
import { createOfflineAdminReportReader } from '../api/_lib/ai/offline-aggregate-review.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMMENT = '33333333-3333-4333-8333-333333333333';
const HIDDEN = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'synthetic-owner-token-not-a-real-jwt';
const summary = { novelId: 1, commentIds: [COMMENT] };
const reply = { novelId: 1, commentId: COMMENT };

function commentFixture() {
  const state = {
    owner: OWNER,
    active: true,
    binding: 'synthetic-session',
    status: 'published',
    body: '架空の感想',
    hidden: false,
    spoiler: false,
    calls: 0
  };
  const reader = createOfflineOwnerEvidenceReader({
    async verifyUser(token) {
      assert.equal(token, TOKEN);
      return { data: { user: { id: OWNER } } };
    },
    async checkSession({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, '1');
      return { active: state.active, binding: state.binding };
    },
    async createAuthorClient({ actorId, token }) {
      assert.equal(actorId, OWNER);
      assert.equal(token, TOKEN);
      return {
        from(table) {
          assert.equal(table, 'novels');
          const query = {
            select(columns) {
              assert.equal(columns, 'id,user_id,status');
              return query;
            },
            eq() {
              return query;
            },
            async maybeSingle() {
              return {
                data: { id: 1, user_id: state.owner, status: state.status }
              };
            }
          };
          return query;
        },
        async rpc(name, args) {
          assert.equal(name, 'novelight_comment_feed');
          assert.deepEqual(args, { p_novel_id: '1', p_limit: 50 });
          state.calls++;
          return {
            data: [
              {
                id: COMMENT,
                body: state.body,
                can_moderate: true,
                is_hidden: state.hidden,
                is_spoiler: state.spoiler,
                display_name: 'PRIVATE_NAME'
              },
              {
                id: HIDDEN,
                body: 'UNSELECTED_HIDDEN_BODY',
                can_moderate: true,
                is_hidden: true,
                is_spoiler: false
              }
            ]
          };
        }
      };
    },
    nowEpochSeconds: () => 1800000000
  });
  return { state, reader };
}

test('comment source flow uses real UUID shape and selected text only', async () => {
  const { state, reader } = commentFixture();
  const feature = 'comment-summary';
  const prepared = await prepareScreenFlow(
    'owner',
    reader,
    feature,
    summary,
    { token: TOKEN }
  );
  assert.match(prepared.prompt.user, /架空の感想/u);
  assert.doesNotMatch(
    prepared.prompt.user,
    /PRIVATE_NAME|UNSELECTED_HIDDEN_BODY/u
  );
  const modelText = JSON.stringify({
    items: [{ kind: 'positive', commentId: COMMENT, offset: 0, quote: '架空' }]
  });
  const result = await prepared.review(
    { requestHash: prepared.requestHash, modelText },
    '架空'
  );
  assert.equal(result.items[0].commentId, COMMENT);
  assert.equal(result.requiresAuthorReview, true);
  assert.equal(state.calls, 2);
});

test('comment reply is draft only; edits and revoked sessions fail closed', async () => {
  const { state, reader } = commentFixture();
  const feature = 'comment-reply-assistant';
  const prepared = await prepareScreenFlow(
    'owner',
    reader,
    feature,
    reply,
    { token: TOKEN }
  );
  const response = {
    requestHash: prepared.requestHash,
    modelText: '{"reply":"ありがとうございます"}'
  };
  const result = await prepared.review(response, 'ありがとうございます');
  assert.equal(result.kind, 'reply_draft');
  assert.equal(result.requiresAuthorReview, true);
  state.body = '変更後';
  await assert.rejects(reader.review(feature, reply, TOKEN, response));
  state.body = '架空の感想';
  state.active = false;
  await assert.rejects(reader.review(feature, reply, TOKEN, response));
});

test('wrong owner, hidden, spoiler and caller-supplied body are rejected', async () => {
  const { state, reader } = commentFixture();
  const feature = 'comment-summary';
  state.owner = OTHER;
  await assert.rejects(reader.prepare(feature, summary, TOKEN));
  assert.equal(state.calls, 0);
  state.owner = OWNER;
  state.hidden = true;
  await assert.rejects(reader.prepare(feature, summary, TOKEN));
  state.hidden = false;
  state.spoiler = true;
  await assert.rejects(reader.prepare(feature, summary, TOKEN));
  state.spoiler = false;
  const injected = { ...summary, body: 'fake' };
  await assert.rejects(reader.prepare(feature, injected, TOKEN));
});

function reportFixture() {
  const state = { actor: OWNER, status: 'new', reads: 0 };
  const supabase = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.actor } } };
      }
    },
    from(table) {
      assert.equal(table, 'content_reports');
      state.reads++;
      const query = {
        select(columns) {
          assert.equal(
            columns,
            'id,novel_id_snapshot,episode_id_snapshot,category,status,created_at'
          );
          return query;
        },
        in(column, values) {
          assert.equal(column, 'status');
          assert.deepEqual(values, ['new', 'reviewing']);
          return query;
        },
        order() {
          return query;
        },
        async limit(n) {
          assert.equal(n, 200);
          return {
            data: [
              {
                id: COMMENT,
                category: 'spam',
                status: state.status,
                novel_id_snapshot: 'PRIVATE_WORK',
                created_at: 'PRIVATE_DATE'
              }
            ]
          };
        }
      };
      return query;
    }
  };
  const reader = createOfflineAdminReportReader({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: OWNER }
  });
  const req = { headers: { authorization: 'Bearer ' + TOKEN } };
  const res = {
    setHeader() {},
    status() {
      return res;
    },
    json() {}
  };
  return { reader, req, res, state };
}

test('admin report source is allowlisted and minimized, not a verdict', async () => {
  const { reader, req, res, state } = reportFixture();
  const prepared = await prepareScreenFlow(
    'report',
    reader,
    'report-triage',
    {},
    { req, res }
  );
  assert.doesNotMatch(prepared.prompt.user, /PRIVATE_WORK|PRIVATE_DATE/u);
  const response = {
    requestHash: prepared.requestHash,
    modelText: JSON.stringify({ ids: [COMMENT] })
  };
  const result = await prepared.review(response, 'spam');
  assert.equal(result.violationVerified, false);
  assert.equal(result.items[0].id, COMMENT);
  state.status = 'reviewing';
  await assert.rejects(reader.review(req, res, response));
  state.actor = OTHER;
  const reads = state.reads;
  await assert.rejects(reader.prepare(req, res));
  assert.equal(state.reads, reads);
});
