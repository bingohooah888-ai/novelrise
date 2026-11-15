import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnregisteredFormalWalletCohortInspector } from '../api/_lib/reader-reward/formal-wallet-cohort-inspector.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';
import { createFormalUsageHttpHandlers } from '../api/_lib/reader-reward/formal-usage-http.js';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-4222-8222-222222222222';
const counts = {
  population_users: '4',
  wallet_users: '3',
  ledger_users: '3',
  ledger_without_wallet_users: '1',
  wallet_without_ledger_users: '1',
  wallet_balance_mismatch_users: '1',
  eligible_exceeds_available_users: '0',
  negative_ledger_users: '0',
  unsettled_ledger_users: '1',
  unsettled_ledger_rows: '2',
  held_wallet_users: '1',
  wallet_available_points: '9000',
  wallet_reserved_points: '1000',
  wallet_eligible_points: '4000',
  ledger_confirmed_net_points: '10800'
};
const clean = {
  ...counts,
  population_users: '1',
  wallet_users: '1',
  ledger_users: '1',
  ledger_without_wallet_users: '0',
  wallet_without_ledger_users: '0',
  wallet_balance_mismatch_users: '0',
  unsettled_ledger_users: '0',
  unsettled_ledger_rows: '0',
  held_wallet_users: '0',
  wallet_available_points: '8000',
  wallet_reserved_points: '0',
  wallet_eligible_points: '0',
  ledger_confirmed_net_points: '8000'
};
function fixture(value = counts) {
  const sqlCalls = [];
  const inspector = createUnregisteredFormalWalletCohortInspector({
    query: async (sql) => {
      sqlCalls.push(sql);
      return { rows: [value] };
    }
  });
  return { sqlCalls, inspector };
}
const auth = {
  auth: {
    async getUser(token) {
      const id = token === 'admin' ? ADMIN : token === 'reader' ? READER : null;
      return {
        data: { user: id ? { id } : null },
        error: id ? null : Error('INVALID_TOKEN')
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
    query: { view: 'wallet_cohort' },
    headers: {
      authorization: 'Bearer ' + token,
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }
  };
}

test('one read-only canonical query diagnoses unseeded Wallet, mismatch and unsettled Point', async () => {
  const { inspector, sqlCalls } = fixture();
  const report = await inspector.inspect();
  assert.equal(report.status, 'formal_wallet_cohort_review_only');
  assert.deepEqual(
    report.observed,
    Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [key, Number(value)])
    )
  );
  assert.equal(sqlCalls.length, 1);
  assert.match(sqlCalls[0], /^\s*with ledger as \(/i);
  assert.match(sqlCalls[0], /full outer join ledger/);
  assert.match(
    sqlCalls[0],
    /available_points \+ reserved_points <> confirmed_points/
  );
  assert.doesNotMatch(
    sqlCalls[0],
    /\b(insert|update|delete|drop|alter|truncate)\s+\w+/i
  );
  assert.ok(report.blockers.includes('canonical_ledger_users_without_wallet'));
  assert.ok(
    report.blockers.includes('wallet_and_confirmed_ledger_balance_mismatch')
  );
  assert.ok(
    report.blockers.includes('unsettled_canonical_point_rows_require_review')
  );
  assert.equal(report.mayWriteDb, false);
  assert.equal(report.maySpendPoints, false);
  assert.equal(report.mayEnableGift, false);
  assert.equal(report.mayEnableAi, false);
  assert.equal(report.readyForPublicRelease, false);
  assert.equal(JSON.stringify(report).includes(ADMIN), false);
});

test('even clean synthetic wallet totals do not certify beta unit origin or gift eligibility', async () => {
  const report = await fixture(clean).inspector.inspect();
  assert.equal(report.observed.wallet_balance_mismatch_users, 0);
  assert.deepEqual(report.blockers, [
    'beta_point_per_event_unit_provenance_unverified',
    'exchange_eligible_origin_not_independently_verified',
    'formal_wallet_staging_and_release_approval_pending'
  ]);
  assert.equal(report.wholeCohortLedgerMatchesVerified, false);
  assert.equal(report.giftEligibilitySourceVerified, false);
  assert.equal(report.readyForPublicRelease, false);
});

test('unreliable counts and unsafe totals fail closed', async () => {
  await assert.rejects(() =>
    fixture({ ...counts, wallet_users: '9007199254740992' }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...counts, ledger_without_wallet_users: '4' }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...counts, unsettled_ledger_rows: '0' }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...counts, wallet_eligible_points: '99999' }).inspector.inspect()
  );
  await assert.rejects(() =>
    fixture({ ...counts, wallet_reserved_points: '-2' }).inspector.inspect()
  );
});

test('unregistered application creates no DB connection and exposes aggregate-only inspector', async () => {
  const calls = [];
  const app = createUnregisteredFormalApplication({
    pool: {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [clean] };
      },
      connect: async () => {
        throw Error('NO_DB_TRANSACTIONS_AUTHORIZED');
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
  assert.equal(typeof app.inspectWalletCohort, 'function');
  const report = await app.inspectWalletCohort();
  assert.equal(report.observed.wallet_users, 1);
  assert.equal(calls.length, 1);
});

test('admin-only view authenticates before any Wallet cohort SQL; reader cannot invoke it', async () => {
  const { inspector, sqlCalls } = fixture(clean);
  const names = [
    'getReaderSnapshot',
    'requestExchange',
    'requestAiUse',
    'listPendingExchanges',
    'listRefundCandidates',
    'resolveExchange',
    'refundCommitted'
  ];
  const service = Object.fromEntries(
    names.map((name) => [name, async () => ({ status: 'formal_use_disabled' })])
  );
  const handlers = createFormalUsageHttpHandlers({
    supabase: auth,
    service,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN },
    getAdminWalletCohort: inspector.inspect
  });
  const blocked = response();
  await handlers.admin(request('reader'), blocked);
  assert.equal(blocked.code, 403);
  assert.equal(sqlCalls.length, 0);
  const unauthenticated = response();
  await handlers.admin(request('bad-token'), unauthenticated);
  assert.notEqual(unauthenticated.code, 200);
  assert.equal(sqlCalls.length, 0);
  const authorized = response();
  await handlers.admin(request('admin'), authorized);
  assert.equal(authorized.code, 200);
  assert.equal(authorized.body.ok, true);
  assert.equal(authorized.body.observed.wallet_users, 1);
  assert.equal(authorized.body.mayIssuePoints, false);
  assert.equal(sqlCalls.length, 1);
});
