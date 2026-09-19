import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDiscoveryWatch,
  buildFavoriteCounts,
  calculateRetention,
  calculateWorksPerReader,
  countExposureByPlan,
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
    method: overrides.method ?? 'GET',
    headers: {
      authorization: 'Bearer valid-token',
      host: 'novelight.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      ...overrides.headers
    },
    query: {
      ...overrides.query
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
  assert.throws(() => parseAdminAllowlist({}), /not configured/);
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

test('discovery watch identifies works NOVELIGHT did not expose and exposed works with no 10-second read', () => {
  const watch = buildDiscoveryWatch({
    windowDays: 7,
    novels: [
      {
        id: 10,
        title: '露出なし',
        status: 'published',
        created_at: '2026-08-01T00:00:00.000Z'
      },
      {
        id: 20,
        title: '露出はある',
        status: 'published',
        created_at: '2026-08-02T00:00:00.000Z'
      },
      {
        id: 30,
        title: '読まれた',
        status: 'published',
        created_at: '2026-08-03T00:00:00.000Z'
      },
      {
        id: 40,
        title: '下書き',
        status: 'draft',
        created_at: '2026-08-04T00:00:00.000Z'
      }
    ],
    exposureRows: [
      { novel_id_snapshot: '20' },
      { novel_id_snapshot: '20' },
      { novel_id_snapshot: '30' }
    ],
    conversionRows: [
      { novel_id_snapshot: '20', event_type: 'detail_open' },
      { novel_id_snapshot: '30', event_type: 'detail_open' },
      { novel_id_snapshot: '30', event_type: 'episode_read_10s' }
    ]
  });

  assert.equal(watch.windowDays, 7);
  assert.equal(watch.publishedWorks, 3);
  assert.equal(watch.noExposureCount, 1);
  assert.equal(watch.exposedNoReadCount, 1);
  assert.deepEqual(
    watch.works.map((work) => ({
      id: work.id,
      state: work.state,
      impressions: work.impressions,
      detailOpens: work.detailOpens,
      bodyReads10s: work.bodyReads10s
    })),
    [
      {
        id: '10',
        state: 'no_exposure',
        impressions: 0,
        detailOpens: 0,
        bodyReads10s: 0
      },
      {
        id: '20',
        state: 'exposed_no_read',
        impressions: 2,
        detailOpens: 1,
        bodyReads10s: 0
      }
    ]
  );
});

test('discovery watch is observation-only and limits the returned work list', () => {
  const novels = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    title: `作品${index + 1}`,
    status: 'published',
    created_at: `2026-08-${String((index % 20) + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  const watch = buildDiscoveryWatch({
    novels,
    exposureRows: [],
    conversionRows: [],
    windowDays: 30,
    limit: 5
  });

  assert.equal(watch.noExposureCount, 25);
  assert.equal(watch.exposedNoReadCount, 0);
  assert.equal(watch.works.length, 5);
  assert.equal('rank' in watch.works[0], false);
  assert.equal('score' in watch.works[0], false);
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

test('admin favorite metrics use favorite rows and exclude author self-favorites', () => {
  const novels = [
    { id: 10, user_id: ADMIN_ID },
    { id: 20, user_id: OTHER_ID }
  ];
  const metrics = buildFavoriteCounts({
    novels,
    favorites: [
      { novel_id: 10, user_id: ADMIN_ID },
      { novel_id: 10, user_id: OTHER_ID },
      { novel_id: 20, user_id: ADMIN_ID }
    ]
  });

  assert.equal(metrics.total, 2);
  assert.equal(metrics.byNovel.get('10'), 1);
  assert.equal(metrics.byNovel.get('20'), 1);
});

test('works-per-reader KPI deduplicates repeated detail opens per reader and work', () => {
  const metric = calculateWorksPerReader({
    cutoff: '2026-09-01T00:00:00.000Z',
    rows: [
      {
        viewer_key_hash: 'a',
        novel_id_snapshot: '10',
        event_type: 'detail_open',
        occurred_at: '2026-09-02T00:00:00.000Z'
      },
      {
        viewer_key_hash: 'a',
        novel_id_snapshot: '10',
        event_type: 'detail_open',
        occurred_at: '2026-09-03T00:00:00.000Z'
      },
      {
        viewer_key_hash: 'a',
        novel_id_snapshot: '20',
        event_type: 'detail_open',
        occurred_at: '2026-09-03T00:00:00.000Z'
      },
      {
        viewer_key_hash: 'b',
        novel_id_snapshot: '10',
        event_type: 'detail_open',
        occurred_at: '2026-09-04T00:00:00.000Z'
      },
      {
        viewer_key_hash: 'b',
        novel_id_snapshot: '20',
        event_type: 'favorite_added',
        occurred_at: '2026-09-04T00:00:00.000Z'
      },
      {
        viewer_key_hash: 'c',
        novel_id_snapshot: '30',
        event_type: 'detail_open',
        occurred_at: '2026-08-20T00:00:00.000Z'
      }
    ]
  });

  assert.deepEqual(metric, {
    readers: 2,
    uniqueWorkViews: 3,
    averageWorksPerReader: 1.5
  });
});

test('plan exposure KPI preserves the exposure-time plan snapshot', () => {
  assert.deepEqual(
    countExposureByPlan([
      { plan_snapshot: 'free' },
      { plan_snapshot: 'standard' },
      { plan_snapshot: 'standard' },
      { plan_snapshot: 'premium' },
      { plan_snapshot: 'unknown' }
    ]),
    { free: 1, standard: 2, premium: 1 }
  );
});
