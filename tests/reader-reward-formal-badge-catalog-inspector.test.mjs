import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUnregisteredFormalBadgeCatalogInspector,
  FORMAL_READER_BADGE_CATALOG
} from '../api/_lib/reader-reward/formal-badge-catalog-inspector.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';
import { createFormalUsageHttpHandlers } from '../api/_lib/reader-reward/formal-usage-http.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-4222-8222-222222222222';
const rows = Array.from({ length: 100 }, (_, i) => {
  const difficulty = i < 30 ? 'easy' : i < 80 ? 'normal' : 'hard';
  return {
    badge_id: 'reader_catalog_' + String(i + 1).padStart(3, '0'),
    difficulty,
    sort_order: i + 1,
    enabled: i < 58,
    point_reward:
      difficulty === 'easy' ? 10 : difficulty === 'normal' ? 61 : 250
  };
});

function adapter(catalog = rows) {
  const calls = [];
  const inspector = createUnregisteredFormalBadgeCatalogInspector({
    query: async (sql, args) => {
      calls.push({ sql, args });
      return { rows: catalog };
    }
  });
  return { inspector, calls };
}

function response() {
  return {
    code: 200,
    body: null,
    setHeader() {},
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
function request(token) {
  return {
    method: 'GET',
    query: { view: 'badge_catalog' },
    headers: {
      authorization: 'Bearer ' + token,
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }
  };
}
const auth = {
  auth: {
    async getUser(token) {
      const id = token === 'admin' ? ADMIN : token === 'reader' ? READER : null;
      return {
        data: { user: id ? { id, email: 'example@novelight.jp' } : null },
        error: id ? null : new Error('UNAUTHORIZED')
      };
    }
  }
};

test('100 canonical reader badges are read without granting historical awards', async () => {
  const { inspector, calls } = adapter();
  const result = await inspector.inspect();
  assert.equal(FORMAL_READER_BADGE_CATALOG.total, 100);
  assert.equal(result.status, 'formal_badge_catalog_review_only');
  assert.deepEqual(result.observed, {
    total: 100,
    easy: 30,
    normal: 50,
    hard: 20,
    enabled: 58,
    theoreticalPointReward: 8350
  });
  assert.deepEqual(result.blockers, [
    'reader_badge_release_gates_not_enabled',
    'badge_history_and_10x_ledger_reconciliation_required'
  ]);
  assert.equal(result.betaPointTenfoldMigrationVerified, false);
  assert.equal(result.readyForPublicRelease, false);
  assert.equal(result.mayWriteDb, false);
  assert.equal(result.mayIssuePoints, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^select\b/i);
  assert.match(calls[0].sql, /badge_category='reader'/);
  assert.doesNotMatch(calls[0].sql, /\b(insert|update|delete|alter|drop)\b/i);
});

test('catalog damage, wrong Point unit and premature launch all remain blocked', async () => {
  const short = await adapter(rows.slice(0, 99)).inspector.inspect();
  assert.ok(short.blockers.includes('reader_badge_count_mismatch'));
  const wrong = await adapter(
    rows.map((r, i) => (i === 0 ? { ...r, point_reward: 1 } : r))
  ).inspector.inspect();
  assert.ok(
    wrong.blockers.includes('reader_badge_point_unit_or_reward_mismatch')
  );
  const allEnabled = await adapter(
    rows.map((r) => ({ ...r, enabled: true }))
  ).inspector.inspect();
  assert.equal(allEnabled.observed.enabled, 100);
  assert.equal(allEnabled.readyForPublicRelease, false);
  assert.equal(allEnabled.blockers.length, 1);
  await assert.rejects(() => adapter([rows[0], rows[0]]).inspector.inspect());
  await assert.rejects(() =>
    adapter([{ ...rows[0], point_reward: -1 }]).inspector.inspect()
  );
});

test('the dormant formal application exposes only a read-only admin catalog inspector', async () => {
  let queries = 0;
  const pool = {
    async query(sql) {
      queries++;
      assert.match(sql, /^select\b/i);
      return { rows };
    },
    async connect() {
      throw new Error('FORMAL_DB_WRITE_DISALLOWED');
    }
  };
  const app = createUnregisteredFormalApplication({
    pool,
    supabase: auth,
    releaseTimestampIso: '2026-11-15T00:00:00.000Z',
    unitVerification: {},
    releaseConfiguration: {
      formalRewardsEnabled: false,
      formalEarningsEnabled: false,
      productionCutoverApproved: false
    },
    trustedServerAuthorization: {
      verifiedByTrustedServer: false,
      serviceRoleVerified: false
    }
  });
  assert.equal(queries, 0);
  assert.equal(typeof app.inspectReaderBadgeCatalog, 'function');
  const report = await app.inspectReaderBadgeCatalog();
  assert.equal(report.observed.total, 100);
  assert.equal(queries, 1);
});

test('admin GET catalog requires server-verified administrator before any SQL', async () => {
  const { inspector, calls } = adapter();
  const service = Object.fromEntries(
    [
      'getReaderSnapshot',
      'requestExchange',
      'requestAiUse',
      'listPendingExchanges',
      'listRefundCandidates',
      'resolveExchange',
      'refundCommitted'
    ].map((method) => [method, async () => ({ status: 'formal_use_disabled' })])
  );
  const api = createFormalUsageHttpHandlers({
    supabase: auth,
    service,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN },
    getAdminBadgeCatalog: inspector.inspect
  });
  const readerRes = response();
  await api.admin(request('reader'), readerRes);
  assert.equal(readerRes.code, 403);
  assert.equal(calls.length, 0);
  const invalid = response();
  await api.admin(request('invalid'), invalid);
  assert.notEqual(invalid.code, 200);
  assert.equal(calls.length, 0);
  const good = response();
  await api.admin(request('admin'), good);
  assert.equal(good.code, 200);
  assert.equal(good.body.ok, true);
  assert.equal(good.body.observed.total, 100);
  assert.equal(good.body.mayWriteDb, false);
  assert.equal(calls.length, 1);
});
