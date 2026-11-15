import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnregisteredFormalSettlementRecoveryInspector } from '../api/_lib/reader-reward/formal-settlement-recovery-inspector.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';
import { createFormalUsageHttpHandlers } from '../api/_lib/reader-reward/formal-usage-http.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-4222-8222-222222222222';
const faulty = {
  operations_total: '4',
  reserved_operations: '1',
  committed_operations: '1',
  released_operations: '1',
  refunded_operations: '1',
  history_mismatch_operations: '1',
  missing_spend_operations: '1',
  unexpected_spend_operations: '1',
  invalid_spend_operations: '1',
  missing_refund_operations: '1',
  unexpected_refund_operations: '1',
  invalid_refund_operations: '1',
  orphan_settlement_ledger_events: '2'
};
const clean = {
  ...faulty,
  operations_total: '2',
  reserved_operations: '0',
  committed_operations: '1',
  released_operations: '0',
  refunded_operations: '1',
  history_mismatch_operations: '0',
  missing_spend_operations: '0',
  unexpected_spend_operations: '0',
  invalid_spend_operations: '0',
  missing_refund_operations: '0',
  unexpected_refund_operations: '0',
  invalid_refund_operations: '0',
  orphan_settlement_ledger_events: '0'
};
function fixture(result = faulty) {
  const calls = [];
  const inspector = createUnregisteredFormalSettlementRecoveryInspector({
    query: async (sql) => {
      calls.push(sql);
      return { rows: [result] };
    }
  });
  return { inspector, calls };
}
const auth = {
  auth: {
    async getUser(token) {
      const userId =
        token === 'admin' ? ADMIN : token === 'reader' ? READER : null;
      return {
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : Error('INVALID_TOKEN')
      };
    }
  }
};
function response() {
  return {
    code: null,
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
    query: { view: 'settlement_recovery' },
    headers: {
      authorization: 'Bearer ' + token,
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }
  };
}

test('read-only SQL covers private phases, exact spend/refund keys and orphan events', async () => {
  const { inspector, calls } = fixture();
  const report = await inspector.inspect();
  assert.equal(report.status, 'formal_settlement_recovery_review_only');
  assert.equal(report.observed.operations_total, 4);
  assert.equal(report.observed.orphan_settlement_ledger_events, 2);
  assert.equal(calls.length, 1);
  const sql = calls[0];
  assert.match(sql, /^\s*with histories as \(/i);
  assert.match(sql, /scout_point_usage_events/);
  assert.match(sql, /scout_point_usage_operations/);
  assert.match(sql, /scout-formal-spend:/);
  assert.match(sql, /scout-formal-refund:/);
  assert.match(sql, /refund_reversal is distinct from spend_id/);
  assert.match(sql, /from orphaned o left join checked c on true/);
  assert.match(sql, /count\(c.operation_id\)::text as operations_total/);
  assert.doesNotMatch(
    sql,
    /\b(insert|update|delete|truncate|alter|drop)\s+\w+/i
  );
  assert.ok(
    report.blockers.includes(
      'committed_debit_or_phase_mismatch_requires_review'
    )
  );
  assert.ok(
    report.blockers.includes(
      'refund_provenance_or_phase_mismatch_requires_review'
    )
  );
  assert.ok(
    report.blockers.includes('unbound_settlement_ledger_events_require_review')
  );
  assert.equal(report.mayResumeWriters, false);
  assert.equal(report.mayWriteDb, false);
  assert.equal(report.maySettle, false);
  assert.equal(report.mayRefund, false);
  assert.equal(report.maySpendPoints, false);
  assert.equal(report.mayEnableGift, false);
  assert.equal(report.mayEnableAi, false);
  assert.equal(report.readyForPublicRelease, false);
  assert.equal(JSON.stringify(report).includes(ADMIN), false);
});

test('even clean synthetic operation reports do not authorize provider recovery', async () => {
  const { inspector } = fixture(clean);
  const report = await inspector.inspect();
  assert.deepEqual(report.blockers, [
    'provider_fulfillment_and_refund_finality_unverified',
    'wallet_budget_canonical_ledger_census_required',
    'owner_approval_required_for_any_recovery_or_release'
  ]);
  assert.equal(report.actualProviderOutcomeVerified, false);
  assert.equal(report.historicOperationsRecovered, false);
  assert.equal(report.mayResumeWriters, false);
});

test('orphan-only history remains visible when no private operation rows exist', async () => {
  const zero = Object.fromEntries(Object.keys(faulty).map((key) => [key, '0']));
  zero.orphan_settlement_ledger_events = '3';
  const report = await fixture(zero).inspector.inspect();
  assert.equal(report.observed.operations_total, 0);
  assert.equal(report.observed.orphan_settlement_ledger_events, 3);
  assert.ok(
    report.blockers.includes('unbound_settlement_ledger_events_require_review')
  );
});

test('missing, invalid and inconsistent aggregates fail closed', async () => {
  await assert.rejects(() =>
    fixture({ ...clean, operations_total: '3' }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...clean, missing_spend_operations: '3' }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({
      ...clean,
      orphan_settlement_ledger_events: '-1'
    }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({
      ...clean,
      refunded_operations: '9007199254740992'
    }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...clean, invalid_refund_operations: null }).inspector.inspect()
  );
});

test('unregistered application exposes only an inert recovery inspector', async () => {
  const calls = [];
  const app = createUnregisteredFormalApplication({
    pool: {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [clean] };
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
  assert.equal(typeof app.inspectSettlementRecovery, 'function');
  const report = await app.inspectSettlementRecovery();
  assert.equal(report.observed.operations_total, 2);
  assert.equal(calls.length, 1);
  assert.equal(report.mayRefund, false);
});

test('admin authorization precedes any recovery query; readers cannot access it', async () => {
  const { inspector, calls } = fixture(clean);
  const methods = [
    'getReaderSnapshot',
    'requestExchange',
    'requestAiUse',
    'listPendingExchanges',
    'listRefundCandidates',
    'resolveExchange',
    'refundCommitted'
  ];
  const service = Object.fromEntries(
    methods.map((method) => [
      method,
      async () => ({ status: 'formal_use_disabled' })
    ])
  );
  const handlers = createFormalUsageHttpHandlers({
    supabase: auth,
    service,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN },
    getAdminSettlementRecovery: inspector.inspect
  });
  const reader = response();
  await handlers.admin(request('reader'), reader);
  assert.equal(reader.code, 403);
  assert.equal(calls.length, 0);
  const invalid = response();
  await handlers.admin(request('unrecognized'), invalid);
  assert.notEqual(invalid.code, 200);
  assert.equal(calls.length, 0);
  const admin = response();
  await handlers.admin(request('admin'), admin);
  assert.equal(admin.code, 200);
  assert.equal(admin.body.observed.operations_total, 2);
  assert.equal(admin.body.mayResumeWriters, false);
  assert.equal(calls.length, 1);
});
