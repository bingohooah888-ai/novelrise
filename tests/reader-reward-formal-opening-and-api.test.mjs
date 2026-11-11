import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createUnregisteredFormalOpeningSync } from '../api/_lib/reader-reward/formal-opening-sync.js';
import { createUnregisteredFormalApiDispatch } from '../api/_lib/reader-reward/formal-api-dispatch.js';

const USER = '11111111-1111-4111-8111-111111111111';
const RELEASE = '2027-03-01T00:00:00.000Z';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const proof = {
  unitVersion: 'beta_ten_points_per_yen',
  cutoverVerifiedByTrustedServer: true,
  canonicalLedgerReconciled: true,
  formalReleaseAt: RELEASE
};

function harness({
  unresolved = 0,
  post = 0,
  already = false,
  walletError = false,
  orphanUsers = 0,
  legacyBadgeRows = 0
} = {}) {
  const calls = [];
  let releases = 0;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK' ||
        sql.startsWith('SET TRANSACTION')
      )
        return { rows: [] };
      if (sql.includes('as auth_users'))
        return {
          rows: [
            {
              auth_users: '17',
              existing_formal_levels: '0',
              existing_wallets: '0',
              ledger_rows: String(orphanUsers + 1),
              ledger_users: String(orphanUsers + 1),
              matched_ledger_users: '1',
              orphan_ledger_users: String(orphanUsers),
              orphan_ledger_rows: String(orphanUsers),
              unsettled_rows: '0',
              negative_rows: '0',
              single_point_rows: String(orphanUsers + 1),
              legacy_badge_rows: String(legacyBadgeRows)
            }
          ]
        };
      if (sql.includes('from auth.users'))
        return { rows: [{ id: USER, created_at: '2026-10-01T00:00:00.000Z' }] };
      if (sql.includes('from public.scout_point_ledger'))
        return {
          rows: [
            {
              net_points: '470',
              unresolved_rows: String(unresolved),
              postrelease_rows: String(post)
            }
          ]
        };
      if (sql.includes('from novelight_formal_private.scout_level_state'))
        return { rows: already ? [{ user_id: USER }] : [] };
      if (
        sql.includes('from novelight_formal_private.scout_point_usage_wallets')
      )
        return { rows: [] };
      if (sql.includes('initialize_beta_level'))
        return {
          rows: [{ result: { status: 'initialized_or_existing', level: 20 } }]
        };
      if (
        sql.includes(
          'insert into novelight_formal_private.scout_point_usage_wallets'
        )
      ) {
        if (walletError) throw new Error('synthetic wallet failure');
        return {
          rows: [
            {
              user_id: USER,
              available_points: '470',
              exchange_eligible_points: '0'
            }
          ]
        };
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
    release() {
      releases++;
    }
  };
  const pool = {
    query: client.query.bind(client),
    connect: async () => client
  };
  const sync = createUnregisteredFormalOpeningSync({
    pool,
    releaseAt: RELEASE,
    stagingRef: STAGING,
    unitVerification: proof
  });
  return {
    sync,
    calls,
    get releases() {
      return releases;
    }
  };
}

const authorization = {
  approved: true,
  scope: 'staging_formal_opening_bootstrap',
  projectRef: STAGING,
  trustedServerVerified: true,
  canonicalWritersQuiesced: true
};

test('initial beta opening preview reads canonical already-converted balance without issuing points', async () => {
  const h = harness();
  const quote = await h.sync.inspect(USER);
  assert.equal(quote.status, 'opening_seed_quote_only');
  assert.equal(quote.availablePoints, 470);
  assert.equal(quote.exchangeEligiblePoints, 0);
  assert.equal(quote.mayWriteDb, false);
  assert.ok(
    h.calls.every((sql) => /^select /i.test(sql) && !/for update/i.test(sql))
  );
  assert.equal(h.releases, 1);
});

test('Staging cohort readiness is aggregate-only and orphan users block opening even with injected approval', async () => {
  const h = harness({ orphanUsers: 1604 });
  const summary = await h.sync.inspectCohort();
  assert.equal(summary.readyForOpening, false);
  assert.equal(summary.status, 'opening_cohort_blocked');
  assert.equal(summary.totals.orphanLedgerUsers, 1604);
  assert.equal(summary.totals.matchedLedgerUsers, 1);
  assert.equal(summary.totals.singlePointRows, 1605);
  assert.ok(summary.blockers.includes('canonical_point_user_not_in_auth'));
  assert.ok(h.calls.every((sql) => /^select /i.test(sql)));
  const outcome = await h.sync.initializeOne(USER, authorization);
  assert.equal(outcome.status, 'opening_cohort_blocked');
  assert.equal(h.calls.filter((sql) => sql === 'ROLLBACK').length, 1);
  assert.equal(h.calls.filter((sql) => sql === 'COMMIT').length, 0);
  assert.equal(
    h.calls.filter((sql) => /insert into novelight_formal_private/.test(sql))
      .length,
    0
  );
});

test('legacy badge 1-Point units block wallet seeding even if trusted release flags are injected', async () => {
  const h = harness({ legacyBadgeRows: 1 });
  const snapshot = await h.sync.inspectCohort();
  assert.equal(snapshot.readyForOpening, false);
  assert.equal(snapshot.totals.legacyBadgeRows, 1);
  assert.ok(
    snapshot.blockers.includes('historical_badge_points_not_tenfold_converted')
  );
  const result = await h.sync.initializeOne(USER, authorization);
  assert.equal(result.status, 'opening_cohort_blocked');
  assert.equal(h.calls.filter((s) => s === 'ROLLBACK').length, 1);
  assert.equal(
    h.calls.filter((s) => /insert into novelight_formal_private/.test(s))
      .length,
    0
  );
});

test('without explicit Staging approval, no DB query or transaction is run', async () => {
  const h = harness();
  const result = await h.sync.initializeOne(USER, {});
  assert.equal(result.status, 'formal_opening_write_not_approved');
  assert.equal(h.calls.length, 0);
});

test('opening sync reuses existing Level RPC and seeds wallet once in a single transaction (mock only)', async () => {
  const h = harness();
  const r = await h.sync.initializeOne(USER, authorization);
  assert.equal(r.status, 'opening_initialized');
  assert.equal(r.availablePoints, 470);
  assert.equal(r.exchangeEligiblePoints, 0);
  assert.equal(h.calls.filter((s) => s === 'BEGIN').length, 1);
  assert.equal(h.calls.filter((s) => s === 'COMMIT').length, 1);
  assert.equal(
    h.calls.filter((s) => /initialize_beta_level/.test(s)).length,
    1
  );
  assert.equal(
    h.calls.filter((s) =>
      /insert into novelight_formal_private.scout_point_usage_wallets/.test(s)
    ).length,
    1
  );
  assert.ok(h.calls.some((s) => s.includes('for update')));
  assert.equal(h.releases, 1);
});

test('unresolved or postrelease ledger and existing state never create a wallet', async () => {
  for (const options of [{ unresolved: 1 }, { post: 1 }, { already: true }]) {
    const h = harness(options);
    const r = await h.sync.initializeOne(USER, authorization);
    assert.match(r.status, /hold/);
    assert.equal(h.calls.filter((s) => s === 'ROLLBACK').length, 1);
    assert.equal(
      h.calls.filter((s) =>
        /insert into novelight_formal_private.scout_point_usage_wallets/.test(s)
      ).length,
      0
    );
  }
});

test('wallet write error rolls back Level initialization in the same transaction (mock only)', async () => {
  const h = harness({ walletError: true });
  await assert.rejects(
    h.sync.initializeOne(USER, authorization),
    /synthetic wallet failure/
  );
  assert.equal(h.calls.filter((s) => s === 'ROLLBACK').length, 1);
  assert.equal(h.calls.filter((s) => s === 'COMMIT').length, 0);
});

test('unverified unit and non-Staging target cannot initialize', async () => {
  const h = harness();
  const blocked = createUnregisteredFormalOpeningSync({
    pool: {
      connect: async () => {
        throw new Error('must not connect');
      },
      query() {}
    },
    releaseAt: RELEASE,
    unitVerification: {},
    stagingRef: STAGING
  });
  assert.equal(
    (await blocked.initializeOne(USER, authorization)).status,
    'point_cutover_unverified_hold'
  );
  assert.throws(
    () =>
      createUnregisteredFormalOpeningSync({
        pool: { connect() {}, query() {} },
        releaseAt: RELEASE,
        unitVerification: proof,
        stagingRef: 'fiepaguycecrredwrcwx'
      }),
    /STAGING_ONLY/
  );
  assert.equal(h.calls.length, 0);
});

test('API paths are explicitly dispatched to existing authenticated handlers; no automatic registration', async () => {
  let reader = 0,
    admin = 0;
  const router = createUnregisteredFormalApiDispatch({
    application: {
      readerHttp: async () => {
        reader++;
      },
      adminHttp: async () => {
        admin++;
      }
    },
    readerPath: '/api/scout-formal-reader',
    adminPath: '/api/scout-formal-admin'
  });
  const res = {
    status(c) {
      this.code = c;
      return this;
    },
    json(x) {
      this.payload = x;
      return this;
    }
  };
  await router.dispatch({ url: '/api/scout-formal-reader?x=1' }, res);
  await router.dispatch({ url: '/api/scout-formal-admin' }, res);
  await router.dispatch({ url: '/api/other' }, res);
  assert.equal(reader, 1);
  assert.equal(admin, 1);
  assert.equal(res.code, 404);
  assert.throws(
    () =>
      createUnregisteredFormalApiDispatch({
        application: { readerHttp() {}, adminHttp() {} },
        readerPath: '/api/same',
        adminPath: '/api/same'
      }),
    /distinct/
  );
});

test('only four proposed private reward tables, no trigger/function/GRANT/ledger mutations', () => {
  const sql = readFileSync(
    new URL(
      '../docs/plans/SCOUT-FORMAL-EARNINGS-4TABLE-STAGING-APPLY-20261111.sql',
      import.meta.url
    ),
    'utf8'
  );
  const names = [
    ...sql.matchAll(/^create table novelight_formal_private\.([a-z_]+)\s*\(/gm)
  ].map((x) => x[1]);
  assert.deepEqual(names, [
    'scout_read_level_evidence',
    'scout_comment_eligibility',
    'scout_comment_review_evidence',
    'scout_earning_delivery'
  ]);
  assert.equal((sql.match(/enable row level security;/g) || []).length, 4);
  const active = sql
    .split('\n')
    .filter((x) => !x.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(
    active,
    /create (trigger|function)|grant (usage|select|insert|update|execute)|insert into|update public\.|alter table public\./i
  );
});

test('reader and admin screen bindings only mount upon explicit invocation with injected endpoints', () => {
  const c = { calls: [], URLSearchParams };
  c.NovelightFormalRewardTransport = {
    createFormalRewardTransport({ endpoint }) {
      c.calls.push(['transport', endpoint]);
      return async () => ({ serverVerified: true });
    }
  };
  c.NovelightFormalRewardMount = {
    mountFormalReaderReward(opts) {
      c.calls.push(['reader', opts]);
      return 'reader-mounted';
    },
    mountFormalRewardAdmin(opts) {
      c.calls.push(['admin', opts]);
      return 'admin-mounted';
    }
  };
  runInNewContext(
    readFileSync(
      new URL('../assets/formal-scout-reward-page.js', import.meta.url),
      'utf8'
    ),
    c
  );
  const prepared = c.NovelightFormalRewardPage.prepareFormalRewardPage({
    readerRoot: {},
    adminRoot: {},
    authorized: false,
    readerEndpoint: '/api/scout-formal-reader',
    adminEndpoint: '/api/scout-formal-admin',
    getAccessToken: async () => 'synthetic',
    fetchImpl: async () => ({}),
    nextOperationId: () => USER
  });
  assert.equal(c.calls.length, 0);
  assert.equal(prepared.reader(), 'reader-mounted');
  assert.equal(prepared.admin(), 'admin-mounted');
  assert.equal(c.calls[3][1].authorized, false);
});
