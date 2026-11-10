import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFormalAdminCommentReviewHandler } from '../api/_lib/reader-reward/formal-admin-comment-review.js';
import { createFormalDurableDelivery } from '../api/_lib/reader-reward/formal-earning-durable.js';

const commentId = '00000000-0000-4000-8000-000000000101';
const reviewerId = '00000000-0000-4000-8000-000000000105';
const ownerId = '00000000-0000-4000-8000-000000000103';
const body = '伏線の回収に驚きました';
const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
const release = '2027-01-01T00:00:00Z';
const launch = {
  formalEarningsEnabled: true,
  productionCutoverApproved: true,
  formalWorkerEnabled: true
};
const trust = {
  serviceRoleVerified: true,
  verifiedByTrustedServer: true
};
const allowlist = { NOVELIGHT_ADMIN_USER_IDS: reviewerId };
const submission = {
  comment_id: commentId,
  eligible: true,
  reviewer_rule: 'human-content-v1',
  reviewed_body_sha256: bodyHash
};

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-admin-session',
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    },
    body: { ...submission },
    ...overrides
  };
}

function response() {
  return {
    code: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(value) {
      this.code = value;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
}

function fixture({
  user = { id: reviewerId, email: 'admin@example.test' },
  commentBody = body,
  reviewStatus = 'review_recorded'
} = {}) {
  const calls = [];
  let authCalls = 0;
  const supabase = {
    auth: {
      async getUser(token) {
        authCalls++;
        return {
          data: { user: token === 'verified-admin-session' ? user : null },
          error:
            token === 'verified-admin-session'
              ? null
              : { message: 'bad session' }
        };
      }
    }
  };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('from public.novel_comments where id=')) {
        return {
          rows: [
            {
              id: commentId,
              user_id: ownerId,
              episode_id: 17,
              body: commentBody,
              created_at: '2027-02-01T00:00:00Z',
              deleted_at: null,
              author_hidden_at: null
            }
          ]
        };
      }
      if (sql.includes('from public.novel_comments where user_id='))
        return { rows: [] };
      if (sql.includes('decide_earning_review_draft')) {
        return { rows: [{ result: { status: reviewStatus } }] };
      }
      throw new Error('Unsafe SQL or Point writer attempted');
    }
  };
  const build = (opts = {}) =>
    createFormalAdminCommentReviewHandler({
      supabase,
      postgresClient: client,
      releaseTimestampIso: release,
      launchConfiguration: launch,
      trustedServerAuthorization: trust,
      env: allowlist,
      ...opts
    });
  return {
    build,
    calls,
    get authCalls() {
      return authCalls;
    }
  };
}

test('unregistered handler verifies existing admin auth before recording any private review', async () => {
  const f = fixture();
  const res = response();
  await f.build()(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.payload, { ok: true, status: 'review_recorded' });
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(f.authCalls, 1);
  const review = f.calls.find((entry) =>
    entry.sql.includes('decide_earning_review_draft')
  );
  assert.ok(review, 'private fixed SQL called only after admin verification');
  assert.deepEqual(review.values.slice(0, 4), [
    commentId,
    true,
    'human-content-v1',
    reviewerId
  ]);
  assert.match(review.values[4], /^[0-9a-f-]{36}$/i);
  assert.deepEqual(review.values.slice(5), [bodyHash, 17]);
  assert.equal(
    f.calls.some((x) => x.sql.includes('award_comment_points_draft')),
    false
  );
});

test('disabled formal cutover blocks admin and all DB queries', async () => {
  const f = fixture();
  const res = response();
  await f.build({
    launchConfiguration: { ...launch, formalWorkerEnabled: false }
  })(request(), res);
  assert.equal(res.code, 403);
  assert.equal(res.payload.error, 'FORMAL_REVIEW_DISABLED');
  assert.equal(f.authCalls, 0);
  assert.equal(f.calls.length, 0);
});

test('missing bearer, rejected auth, unlisted reviewer and cross-site request never write', async () => {
  const scenarios = [
    [
      fixture(),
      request({ headers: { ...request().headers, authorization: '' } }),
      401
    ],
    [
      fixture(),
      request({
        headers: { ...request().headers, authorization: 'Bearer invalid' }
      }),
      401
    ],
    [
      fixture({
        user: {
          id: '00000000-0000-4000-8000-000000000109',
          email: 'other@example.test'
        }
      }),
      request(),
      403
    ],
    [
      fixture(),
      request({
        headers: { ...request().headers, origin: 'https://attacker.example' }
      }),
      403
    ],
    [
      fixture(),
      request({ headers: { ...request().headers, origin: undefined } }),
      403
    ]
  ];
  for (const [f, req, expected] of scenarios) {
    const res = response();
    await f.build()(req, res);
    assert.equal(res.code, expected);
    assert.equal(f.calls.length, 0);
  }
});

test('untrusted client cannot provide reviewer ID or malformed verdict/source', async () => {
  const badBodies = [
    { ...submission, reviewer_id: reviewerId },
    { ...submission, eligible: 'true' },
    { ...submission, reviewer_rule: '' },
    { ...submission, reviewed_body_sha256: '0'.repeat(63) }
  ];
  for (const bodyValue of badBodies) {
    const f = fixture();
    const res = response();
    await f.build()(request({ body: bodyValue }), res);
    assert.equal(res.code, 400);
    assert.equal(f.calls.length, 0);
  }
});

test('stale admin preview fails closed before private review SQL', async () => {
  const f = fixture({ commentBody: '投稿者が内容を更新しました' });
  const res = response();
  await f.build()(request(), res);
  assert.equal(res.code, 409);
  assert.equal(res.payload.error, 'review_source_changed');
  assert.equal(
    f.calls.some(({ sql }) => sql.includes('decide_earning_review_draft')),
    false
  );
});

test('private DB conflict is held and no audit claim is fabricated', async () => {
  const f = fixture({ reviewStatus: 'review_conflict_requires_owner_policy' });
  const res = response();
  await f.build()(request(), res);
  assert.equal(res.code, 409);
  assert.equal(res.payload.error, 'review_conflict_requires_owner_policy');
  assert.equal(res.payload.ok, false);
});

test('replayed identical decision reports idempotence without new Point issuance', async () => {
  const f = fixture({ reviewStatus: 'review_already_recorded' });
  const res = response();
  await f.build()(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.status, 'review_already_recorded');
  assert.equal(
    f.calls.some(({ sql }) => sql.includes('award_')),
    false
  );
});

test('direct durable adapter cannot persist a review without structured provenance', async () => {
  let calls = 0;
  const durable = createFormalDurableDelivery({
    postgresClient: {
      query: async () => {
        calls++;
      }
    },
    releaseTimestampIso: release,
    launchConfiguration: launch,
    trustedServerAuthorization: trust
  });
  assert.equal(
    (await durable.resolveReview(commentId, true, 'human-content-v1')).status,
    'review_missing'
  );
  assert.equal(calls, 0);
});

test('admin authentication service failure is fail-closed and never reaches reward DB', async () => {
  let writes = 0;
  const handler = createFormalAdminCommentReviewHandler({
    supabase: {
      auth: {
        getUser: async () => {
          throw Error('internal secret');
        }
      }
    },
    postgresClient: {
      query: async () => {
        writes++;
      }
    },
    releaseTimestampIso: release,
    launchConfiguration: launch,
    trustedServerAuthorization: trust,
    env: allowlist
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 503);
  assert.equal(res.payload.error, 'FORMAL_REVIEW_UNAVAILABLE');
  assert.equal(JSON.stringify(res.payload).includes('secret'), false);
  assert.equal(writes, 0);
});
