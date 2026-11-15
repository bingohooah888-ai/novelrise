import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnregisteredFormalBadgeHistoryInspector } from '../api/_lib/reader-reward/formal-badge-history-inspector.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';
import { createFormalUsageHttpHandlers } from '../api/_lib/reader-reward/formal-usage-http.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-4222-8222-222222222222';
const badgeCounts = {
  earned_badges: '5',
  linked_events: '3',
  earned_without_event: '2',
  current_unit_events: '1',
  legacy_unit_events: '1',
  anomalous_events: '1',
  event_without_earned_status: '1'
};
const pointCounts = {
  unclassified_badge_events: '1',
  orphan_reader_badge_events: '2'
};
function fixture(badges = badgeCounts, points = pointCounts) {
  const calls = [];
  const reader = createUnregisteredFormalBadgeHistoryInspector({
    query: async (sql) => {
      calls.push(sql);
      return {
        rows: [sql.includes('from public.user_scout_badges b') ? badges : points]
      };
    }
  });
  return { reader, calls };
}
const auth = {
  auth: {
    async getUser(token) {
      const id = token === 'admin' ? ADMIN : token === 'reader' ? READER : null;
      return {
        data: { user: id ? { id } : null },
        error: id ? null : new Error('DENIED')
      };
    }
  }
};
function reply() {
  return {
    code: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}
function request(token) {
  return {
    method: 'GET',
    query: { view: 'badge_history' },
    headers: {
      authorization: 'Bearer ' + token,
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }
  };
}

test('aggregates distinguish old/new badge Point units and baseline no-award badges', async () => {
  const { reader, calls } = fixture();
  const report = await reader.inspect();
  assert.equal(report.status, 'formal_badge_history_review_only');
  assert.equal(report.observed.legacy_unit_events, 1);
  assert.equal(report.observed.current_unit_events, 1);
  assert.equal(report.observed.earned_without_event, 2);
  assert.equal(report.observed.orphan_reader_badge_events, 2);
  assert.equal(report.mayWriteDb, false);
  assert.equal(report.mayIssuePoints, false);
  assert.equal(report.historicalMissingPointsMayBeBackfilled, false);
  assert.equal(report.historyFullyReconciled, false);
  assert.equal(report.betaPointTenfoldMigrationVerified, false);
  assert.equal(report.readyForPublicRelease, false);
  assert.ok(
    report.blockers.includes(
      'legacy_badge_point_units_require_reconciliation'
    )
  );
  assert.ok(
    report.blockers.includes(
      'earned_without_point_event_requires_manual_review'
    )
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => /^select\b/i.test(sql)));
  assert.ok(calls.every((sql) => !/\b(insert|update|delete|alter|drop)\b/i.test(sql)));
  assert.match(calls[0], /'badge:' \|\| b\.user_id::text/);
  assert.match(calls[1], /p\.metadata->>'badge_id'/);
  assert.equal(JSON.stringify(report).includes(ADMIN), false);
});

test('even clean synthetic history does not approve whole Point conversion', async () => {
  const clean = {
    ...badgeCounts,
    earned_badges: '3',
    linked_events: '3',
    earned_without_event: '0',
    legacy_unit_events: '0',
    anomalous_events: '0',
    current_unit_events: '3',
    event_without_earned_status: '0'
  };
  const { reader } = fixture(clean, {
    unclassified_badge_events: '0',
    orphan_reader_badge_events: '0'
  });
  const report = await reader.inspect();
  assert.deepEqual(report.blockers, [
    'beta_point_10x_cutover_not_verified',
    'complete_point_ledger_and_wallet_cohort_review_required'
  ]);
  assert.equal(report.readyForPublicRelease, false);
});

test('invalid, missing and inconsistent aggregates fail closed', async () => {
  await assert.rejects(() =>
    fixture({ ...badgeCounts, legacy_unit_events: 'not-a-count' }).reader.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...badgeCounts, linked_events: '2' }).reader.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...badgeCounts, earned_without_event: '6' }).reader.inspect()
  );
});

test('existing unregistered formal application exposes history read without DB writes', async () => {
  const { reader, calls } = fixture();
  const app = createUnregisteredFormalApplication({
    pool: {
      query: async (sql) => {
        calls.push(sql);
        return {
          rows: [sql.includes('from public.user_scout_badges b')
            ? badgeCounts
            : pointCounts]
        };
      },
      connect: async () => {
        throw Error('UNAUTHORIZED_DB_TRANSACTION');
      }
    },
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
  assert.equal(calls.length, 0);
  assert.equal(typeof app.inspectReaderBadgeHistory, 'function');
  const report = await app.inspectReaderBadgeHistory();
  assert.equal(report.observed.earned_badges, 5);
  assert.equal(calls.length, 2);
  assert.equal(typeof reader.inspect, 'function');
});

test('history GET requires trusted admin identity before any aggregate query', async () => {
  const { reader, calls } = fixture();
  const names = [
    'getReaderSnapshot', 'requestExchange', 'requestAiUse',
    'listPendingExchanges', 'listRefundCandidates',
    'resolveExchange', 'refundCommitted'
  ];
  const service = Object.fromEntries(
    names.map((name) => [name, async () => ({ status: 'formal_use_disabled' })])
  );
  const api = createFormalUsageHttpHandlers({
    supabase: auth,
    service,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN },
    getAdminBadgeHistory: reader.inspect
  });
  const blocked = reply();
  await api.admin(request('reader'), blocked);
  assert.equal(blocked.code, 403);
  assert.equal(calls.length, 0);
  const invalid = reply();
  await api.admin(request('invalid'), invalid);
  assert.notEqual(invalid.code, 200);
  assert.equal(calls.length, 0);
  const ok = reply();
  await api.admin(request('admin'), ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.observed.legacy_unit_events, 1);
  assert.equal(ok.body.mayIssuePoints, false);
  assert.equal(calls.length, 2);
});
