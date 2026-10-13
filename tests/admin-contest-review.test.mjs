import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminContestReviewHandler } from '../api/_lib/admin-contest-review.js';

const ADMIN = 'caf00000-0000-4000-8000-000000000099';
const READER = 'caf00000-0000-4000-8000-000000000092';
const CONTEST = 'caf00000-0000-4000-8000-000000000090';

function response() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(key, value) {
      headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.data = body;
      return this;
    }
  };
}

function request(method, body, query, headers = {}) {
  return {
    method,
    body,
    query,
    headers: {
      host: 'novelight.jp',
      origin: 'https://novelight.jp',
      authorization: 'Bearer authenticated-admin',
      ...headers
    }
  };
}

function createDatabase() {
  const rpcCalls = [];
  const tableCalls = [];
  const db = {
    auth: {
      getUser: async (token) =>
        token === 'authenticated-admin'
          ? {
              data: { user: { id: ADMIN, email: 'admin@example.test' } },
              error: null
            }
          : { data: { user: null }, error: { message: 'invalid token' } }
    },
    from(table) {
      tableCalls.push(table);
      const chained = {
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
          return Promise.resolve({ data: [], error: null });
        },
        range() {
          return Promise.resolve({ data: [], count: 0, error: null });
        },
        maybeSingle() {
          if (table === 'novelight_contests') {
            return Promise.resolve({
              data: { id: CONTEST, status: 'draft', public_visible: false },
              error: null
            });
          }
          return Promise.resolve({
            data: { id: READER, review_status: 'provisional' },
            error: null
          });
        }
      };
      return chained;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'novelight_contest_admin_review_reader') {
        return {
          data: {
            ok: true,
            reader_id: READER,
            previous_status: 'provisional',
            review_status: 'review_hold',
            provisional_only: true
          },
          error: null
        };
      }
      return {
        data: {
          ok: true,
          signal_codes: [],
          requires_manual_review: false
        },
        error: null
      };
    }
  };
  return { db, rpcCalls, tableCalls };
}

const env = { NOVELIGHT_ADMIN_USER_IDS: ADMIN };
const note = 'Two overlapping sessions were examined and documented';

test('operator review refuses unauthenticated and cross-origin requests', async () => {
  const { db, rpcCalls } = createDatabase();
  const handler = createAdminContestReviewHandler({ supabase: db, env });
  for (const headers of [
    { authorization: '' },
    { origin: 'https://evil.example' },
    { origin: '' }
  ]) {
    const res = response();
    await handler(request('POST', {}, {}, headers), res);
    assert.ok([401, 403].includes(res.statusCode));
  }
  assert.equal(rpcCalls.length, 0);
});

test('operator review validates inputs and uses verified admin UUID', async () => {
  const { db, rpcCalls } = createDatabase();
  const handler = createAdminContestReviewHandler({ supabase: db, env });
  const bad = response();
  await handler(
    request('POST', {
      action: 'clear',
      expected_status: 'provisional',
      reader_id: READER,
      reason_code: 'anomalous_reading',
      note
    }),
    bad
  );
  assert.equal(bad.statusCode, 400);

  const good = response();
  await handler(
    request('POST', {
      action: 'hold',
      expected_status: 'provisional',
      reader_id: READER,
      reason_code: 'anomalous_reading',
      note
    }),
    good
  );
  assert.equal(good.statusCode, 200);
  assert.equal(good.data.result.review_status, 'review_hold');
  assert.equal(good.data.prize_finalized, false);
  assert.deepEqual(rpcCalls[0], {
    name: 'novelight_contest_admin_review_reader',
    args: {
      p_contest_id: CONTEST,
      p_reader_id: READER,
      p_admin_user_id: ADMIN,
      p_action: 'hold',
      p_expected_status: 'provisional',
      p_reason_code: 'anomalous_reading',
      p_note: note
    }
  });
});

test('list is bounded and returns no secret guest credentials', async () => {
  const { db } = createDatabase();
  const handler = createAdminContestReviewHandler({ supabase: db, env });
  const invalid = response();
  await handler(request('GET', null, { page: '9999' }), invalid);
  assert.equal(invalid.statusCode, 400);
  const valid = response();
  await handler(request('GET', null, { page: '1', limit: '20' }), valid);
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(valid.data.readers, []);
  assert.equal(valid.data.contest_status, 'draft');
  assert.equal(valid.headers['Cache-Control'], 'private, no-store, max-age=0');
});
