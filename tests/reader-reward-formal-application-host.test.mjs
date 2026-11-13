import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const RELEASE = '2026-11-01T00:00:00.000Z';
const CLOCK = '2026-11-11T00:00:00.000Z';

function setup({ unitVerified = true } = {}) {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('scout_point_usage_wallets'))
        return {
          rows: [
            {
              user_id: USER,
              available_points: '40000',
              exchange_eligible_points: '30000',
              reserved_points: '0',
              held_points: '0',
              revision: '1'
            }
          ]
        };
      if (sql.includes('sum(point_value)'))
        return { rows: [{ confirmed_points: '40000' }] };
      if (sql.includes('scout_level_state'))
        return {
          rows: [
            {
              user_id: USER,
              current_level: 42,
              highest_level: 42,
              level_progress_xp: '120',
              review_anchor_at: RELEASE,
              last_review_end_at: null,
              revision: '1'
            }
          ]
        };
      if (sql.includes('scout_xp_ledger'))
        return { rows: [{ earned_xp: '145', negative_rows: '0' }] };
      if (sql.includes('scout_point_ledger'))
        return {
          rows: [
            {
              id: EVENT,
              point_kind: 'formal_read_reward',
              point_value: '20',
              status: 'confirmed',
              occurred_at: CLOCK,
              event_key: 'test-read',
              reversal_of: null
            }
          ]
        };
      if (sql.includes('scout_point_usage_operations')) return { rows: [] };
      throw new Error('Unexpected query: ' + sql);
    },
    async connect() {
      throw new Error('Transactions are not authorized in this test');
    }
  };
  const application = createUnregisteredFormalApplication({
    pool,
    supabase: {
      auth: {
        async getUser(token) {
          return {
            data: { user: token === 'test-session' ? { id: USER } : null },
            error: token === 'test-session' ? null : new Error('denied')
          };
        }
      }
    },
    now: () => Date.parse(CLOCK),
    releaseTimestampIso: RELEASE,
    unitVerification: unitVerified
      ? {
          unitVersion: 'beta_ten_points_per_yen',
          cutoverVerifiedByTrustedServer: true,
          canonicalLedgerReconciled: true,
          formalReleaseAt: RELEASE
        }
      : {},
    releaseConfiguration: {
      formalRewardsEnabled: false,
      formalEarningsEnabled: false,
      productionCutoverApproved: false
    },
    trustedServerAuthorization: {
      verifiedByTrustedServer: false,
      serviceRoleVerified: false
    },
    catalog: [],
    policy: {},
    env: {}
  });
  function response() {
    return {
      code: 200,
      body: null,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
  }
  async function reader(method = 'GET', body, auth = 'Bearer test-session') {
    const res = response();
    await application.readerHttp(
      {
        method,
        body,
        query: {},
        headers: {
          authorization: auth,
          origin: 'https://novelight.jp',
          host: 'novelight.jp',
          'x-forwarded-proto': 'https',
          'sec-fetch-site': 'same-origin'
        }
      },
      res
    );
    return res;
  }
  return { application, calls, reader, pool };
}

test('canonical Level+30-day XP+wallet+Point history reach reader HTTP, without writes', async () => {
  const { application, reader, calls } = setup();
  const res = await reader();
  assert.equal(res.code, 200);
  assert.equal(res.body.serverVerified, true);
  assert.equal(res.body.formalEnabled, false);
  assert.equal(res.body.account.level, 42);
  assert.equal(res.body.account.requiredXp, 400);
  assert.equal(res.body.account.earnedXpInPeriod, 145);
  assert.equal(res.body.wallet.availablePoints, 40000);
  assert.equal(res.body.wallet.exchangeEligiblePoints, 30000);
  assert.equal(res.body.history[0].kind, 'read');
  assert.ok(calls.some((x) => x.sql.includes('scout_xp_ledger')));
  assert.ok(calls.some((x) => x.sql.includes('sum(point_value)')));
  assert.ok(calls.every((x) => /^select\b/i.test(x.sql)));
  assert.equal(
    (await application.drainDueEarnings()).status,
    'formal_worker_disabled'
  );
});

test('unapproved Point mutation remains blocked; missing JWT cannot query database', async () => {
  const { reader, calls } = setup();
  const noAuth = await reader('GET', undefined, '');
  assert.equal(noAuth.code, 401);
  assert.equal(calls.length, 0);
  const post = await reader('POST', {
    action: 'exchange_request',
    operationId: EVENT,
    amountPoints: 30000
  });
  assert.equal(post.code, 403);
  assert.equal(post.body.error, 'formal_use_disabled');
  assert.ok(calls.every((x) => /^select\b/i.test(x.sql)));
});

test('unverified canonical unit blocks even read-only formal snapshot', async () => {
  const { reader } = setup({ unitVerified: false });
  const res = await reader();
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'FORMAL_REWARD_UNAVAILABLE');
});

test('composition requires injected trusted pool and Auth; never registers a route', () => {
  assert.throws(() => createUnregisteredFormalApplication({}), TypeError);
  const { application } = setup();
  assert.equal(typeof application.readerHttp, 'function');
  assert.equal(typeof application.adminHttp, 'function');
  assert.equal(typeof application.bindExistingScheduler, 'function');
  assert.equal(typeof application.bindExistingMaintenanceScheduler, 'function');
  assert.equal(typeof application.reviewDueMaintenance, 'function');
  assert.equal(
    typeof application.inspectMaintenanceConnectionReadiness,
    'function'
  );
  assert.equal(
    application.bindExistingMaintenanceScheduler({}).status,
    'formal_maintenance_disabled'
  );
  assert.equal(Object.hasOwn(application, 'registerApiRoute'), false);
});
