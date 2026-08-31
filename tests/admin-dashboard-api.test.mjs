import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateRetention,
  createAdminDashboardHandler,
  isSameOriginRequest,
  parseAdminAllowlist
} from '../api/_lib/admin-dashboard.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createSupabase(user, authError = null) {
  return {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return {
          data: { user },
          error: authError
        };
      }
    }
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      authorization: 'Bearer valid-token',
      host: 'novelight.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      ...overrides.headers
    },
    query: {
      ...overrides.query
    },
    ...overrides,
    headers: {
      authorization: 'Bearer valid-token',
      host: 'novelight.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      ...overrides.headers
    }
  };
}

async function runHandler({
  req = request(),
  user = { id: ADMIN_ID, email: 'owner@example.com' },
  env = { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
  loadOverview = async ({ days, now }) => ({
    generatedAt: now.toISOString(),
    windowDays: days,
    summary: {}
  }),
  searchUsers = async () => []
} = {}) {
  const res = createResponse();
  const handler = createAdminDashboardHandler({
    supabase: createSupabase(user),
    env,
    loadOverview,
    searchUsers,
    clock: () => new Date('2026-08-31T06:00:00.000Z')
  });

  await handler(req, res);
  return res;
}

test('admin allowlist accepts immutable user IDs and verified account emails', () => {
  const allowlist = parseAdminAllowlist({
    NOVELIGHT_ADMIN_USER_IDS: `${ADMIN_ID}, ${OTHER_ID}`,
    NOVELIGHT_ADMIN_EMAILS: 'Owner@Example.com'
  });

  assert.equal(allowlist.userIds.has(ADMIN_ID), true);
  assert.equal(allowlist.emails.has('owner@example.com'), true);
});

test('admin allowlist fails closed on malformed configuration', () => {
  assert.throws(
    () => parseAdminAllowlist({ NOVELIGHT_ADMIN_USER_IDS: 'not-a-uuid' }),
    /malformed/
  );
  assert.throws(
    () => parseAdminAllowlist({}),
    /not configured/
  );
});

test('same-origin guard rejects cross-site requests', () => {
  assert.equal(
    isSameOriginRequest(
      request({
        headers: {
          origin: 'https://attacker.example',
          'sec-fetch-site': 'cross-site'
        }
      })
    ),
    false
  );

  assert.equal(
    isSameOriginRequest(
      request({
        headers: {
          origin: 'https://novelight.example',
          'sec-fetch-site': 'same-origin'
        }
      })
    ),
    true
  );
});

test('admin API rejects requests without a bearer token', async () => {
  const res = await runHandler({
    req: request({ headers: { authorization: undefined } })
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
  assert.match(String(res.headers.get('cache-control')), /no-store/);
});

test('admin API fails closed when the server allowlist is not configured', async () => {
  const res = await runHandler({ env: {} });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'Admin access is not configured' });
});

test('admin API refuses a valid NOVELIGHT session that is not an admin', async () => {
  let loaded = false;
  const res = await runHandler({
    user: { id: OTHER_ID, email: 'reader@example.com' },
    loadOverview: async () => {
      loaded = true;
      return {};
    }
  });

  assert.equal(res.statusCode, 403);
  assert.equal(loaded, false);
});

test('admin API allows an ID-listed admin and forwards only validated inputs', async () => {
  let overviewArgs;
  let searchArgs;
  const res = await runHandler({
    req: request({ query: { days: '90', q: '作者名' } }),
    loadOverview: async (args) => {
      overviewArgs = args;
      return {
        generatedAt: args.now.toISOString(),
        windowDays: args.days,
        summary: { totalUsers: 3 }
      };
    },
    searchUsers: async (args) => {
      searchArgs = args;
      return [{ id: OTHER_ID, displayName: '作者名' }];
    }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(overviewArgs.days, 90);
  assert.equal(searchArgs.query, '作者名');
  assert.equal(res.body.summary.totalUsers, 3);
  assert.equal(res.body.users.length, 1);
});

test('admin API can authorize by verified auth email without exposing it', async () => {
  const res = await runHandler({
    user: { id: OTHER_ID, email: 'OWNER@example.com' },
    env: { NOVELIGHT_ADMIN_EMAILS: 'owner@example.com' }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes('owner@example.com'), false);
});

test('admin API rejects invalid reporting windows and broad search queries', async () => {
  const badWindow = await runHandler({
    req: request({ query: { days: '365' } })
  });
  assert.equal(badWindow.statusCode, 400);

  const badSearch = await runHandler({
    req: request({ query: { q: 'a' } })
  });
  assert.equal(badSearch.statusCode, 400);
});

test('30-day retention requires a return on or after each users threshold', () => {
  const metric = calculateRetention({
    userIds: new Set([ADMIN_ID, OTHER_ID]),
    lifecycleRows: [
      {
        user_id: ADMIN_ID,
        registered_at: '2026-06-01T00:00:00.000Z',
        last_seen_at: '2026-07-05T00:00:00.000Z'
      },
      {
        user_id: OTHER_ID,
        registered_at: '2026-06-15T00:00:00.000Z',
        last_seen_at: '2026-07-10T00:00:00.000Z'
      },
      {
        user_id: '33333333-3333-4333-8333-333333333333',
        registered_at: '2026-08-20T00:00:00.000Z',
        last_seen_at: '2026-08-30T00:00:00.000Z'
      }
    ],
    days: 30,
    now: new Date('2026-08-31T00:00:00.000Z')
  });

  assert.deepEqual(metric, {
    eligible: 2,
    retained: 1,
    rate: 50
  });
});
