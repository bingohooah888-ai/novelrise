import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHistogram,
  createAdminScoutAnalyticsHandler,
  percentile,
  summarizeScoutData
} from '../api/_lib/admin-scout-analytics.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_TWO = '22222222-2222-4222-8222-222222222222';
const USER_THREE = '33333333-3333-4333-8333-333333333333';
const USER_FOUR = '44444444-4444-4444-8444-444444444444';

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
    query: { ...overrides.query }
  };
}

function authOnlySupabase(user = { id: ADMIN_ID, email: 'owner@example.com' }) {
  return {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return { data: { user }, error: null };
      }
    }
  };
}

test('SCOUT percentile and histogram keep zero-XP users in the distribution', () => {
  assert.equal(percentile([0, 0, 33, 155], 0.5), 16.5);
  assert.equal(percentile([0, 0, 33, 155], 0.9), 118.4);
  const histogram = buildHistogram([0, 0, 33, 155]);
  assert.equal(
    histogram.reduce((sum, bucket) => sum + bucket.count, 0),
    4
  );
  assert.equal(histogram[0].count >= 2, true);
});

test('SCOUT beta summary covers XP, source mix, monthly seed use, discovery and user drill-down', () => {
  const now = new Date('2026-09-10T06:00:00.000Z');
  const profiles = [
    { id: ADMIN_ID, display_name: 'Alpha', created_at: '2026-08-01T00:00:00Z' },
    { id: USER_TWO, display_name: 'Beta', created_at: '2026-08-02T00:00:00Z' },
    {
      id: USER_THREE,
      display_name: 'Gamma',
      created_at: '2026-08-03T00:00:00Z'
    },
    { id: USER_FOUR, display_name: 'Delta', created_at: '2026-08-04T00:00:00Z' }
  ];
  const xpRows = [
    {
      user_id: ADMIN_ID,
      source_event_id: 'seed-use',
      xp_kind: 'light_seed_use',
      xp_value: 30,
      occurred_at: '2026-09-09T00:00:00Z'
    },
    {
      user_id: ADMIN_ID,
      source_event_id: 'star',
      xp_kind: 'star_rating',
      xp_value: 3,
      occurred_at: '2026-09-09T00:01:00Z'
    },
    {
      user_id: USER_TWO,
      source_event_id: 'old-comment',
      xp_kind: 'comment',
      xp_value: 5,
      occurred_at: '2026-08-01T00:00:00Z'
    },
    {
      user_id: USER_TWO,
      source_event_id: 'discovery',
      xp_kind: 'light_seed_discovery',
      xp_value: 150,
      occurred_at: '2026-09-05T00:00:00Z'
    }
  ];
  const eventRows = [
    {
      id: 'discovery',
      event_type: 'light_seed_discovery',
      metadata: { base_xp: 150 }
    }
  ];
  const seeds = [
    { reader_id: ADMIN_ID, seed_type: 'GOLD', seed_month: '2026-09-01' },
    { reader_id: ADMIN_ID, seed_type: 'SILVER', seed_month: '2026-09-01' },
    { reader_id: USER_TWO, seed_type: 'BRONZE', seed_month: '2026-09-01' }
  ];
  const discoveryRows = [
    {
      reader_id: ADMIN_ID,
      seed_type: 'GOLD',
      rank_at_seed: 1,
      highest_rank_seen: 3,
      best_rank_delta: 2
    },
    {
      reader_id: USER_TWO,
      seed_type: 'SILVER',
      rank_at_seed: 5,
      highest_rank_seen: 6,
      best_rank_delta: 1
    }
  ];

  const data = summarizeScoutData({
    profiles,
    xpRows,
    eventRows,
    seeds,
    discoveryRows,
    days: 30,
    now,
    query: 'Alpha'
  });

  assert.equal(data.xpDistribution.lifetime.totalXp, 188);
  assert.equal(data.xpDistribution.last30Days.totalXp, 183);
  assert.equal(data.xpDistribution.last90Days.totalXp, 188);
  assert.equal(data.xpDistribution.lifetime.p50, 16.5);
  assert.equal(
    data.sourceComposition.find((item) => item.key === 'discovery_success').xp,
    150
  );
  assert.equal(data.lightSeedUsage.totalUsed, 3);
  assert.equal(data.lightSeedUsage.zeroUseRate, 50);
  assert.equal(data.lightSeedUsage.typeUsed.GOLD, 1);
  assert.equal(data.discovery.byType[0].successRate, 100);
  assert.equal(data.discovery.byType[1].novaPredictionCount, 1);
  assert.equal(data.users.length, 1);
  assert.equal(data.users[0].scoutXp.lifetime, 33);
  assert.equal(data.users[0].lightSeed.usedThisMonth, 2);
});

test('SCOUT admin endpoint stays behind the existing admin allowlist and validates inputs', async () => {
  const loadCalls = [];
  const handler = createAdminScoutAnalyticsHandler({
    supabase: authOnlySupabase(),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadAnalytics: async (args) => {
      loadCalls.push(args);
      return {
        generatedAt: args.now.toISOString(),
        windowDays: args.days,
        users: []
      };
    },
    clock: () => new Date('2026-09-10T06:00:00.000Z')
  });

  const ok = createResponse();
  await handler(request({ query: { days: '90', q: 'Alpha' } }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(loadCalls[0].days, 90);
  assert.equal(loadCalls[0].query, 'Alpha');
  assert.match(String(ok.headers.get('cache-control')), /no-store/);

  const badWindow = createResponse();
  await handler(request({ query: { days: '7' } }), badWindow);
  assert.equal(badWindow.statusCode, 400);

  const badQuery = createResponse();
  await handler(request({ query: { q: 'a' } }), badQuery);
  assert.equal(badQuery.statusCode, 400);
});

test('SCOUT admin endpoint refuses non-admin sessions before loading analytics', async () => {
  let loaded = false;
  const handler = createAdminScoutAnalyticsHandler({
    supabase: authOnlySupabase({ id: USER_TWO, email: 'reader@example.com' }),
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadAnalytics: async () => {
      loaded = true;
      return {};
    }
  });
  const res = createResponse();
  await handler(request(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(loaded, false);
});
