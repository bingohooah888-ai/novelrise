import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, URLSearchParams } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createUnregisteredFormalNewReaderOnboarding } from '../api/_lib/reader-reward/formal-new-reader-onboarding.js';
import { createFormalUsageHttpHandlers } from '../api/_lib/reader-reward/formal-usage-http.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';

const USER = '11111111-1111-4111-8111-111111111111';
const RELEASE = '2027-02-01T00:00:00.000Z';
const CLOCK = Date.parse('2027-02-10T00:00:00.000Z');
const authorization = {
  approved: true,
  scope: 'staging_formal_new_reader_onboarding',
  projectRef: 'wmlzjgvxgoyrovdhbqbg',
  trustedServerVerified: true,
  approvedUserId: USER,
  maxReaders: 1,
  referenceMode: 'formal_release_single_reader',
  approvedReferenceAt: RELEASE
};
function fixture({
  authorized = false,
  createdAt = '2027-02-02T00:00:00.000Z',
  pointRows = 0,
  xpRows = 0,
  levelRows = 0,
  walletRows = 0,
  failWallet = false,
  authMissing = false,
  approval = authorization,
  stagingProofReference = false
} = {}) {
  const calls = [];
  let released = 0;
  let levels = levelRows,
    wallets = walletRows;
  const query = async (sql, args) => {
    calls.push({ sql, args });
    if (
      [
        'BEGIN',
        'ROLLBACK',
        'COMMIT',
        'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'
      ].includes(sql)
    )
      return { rows: [] };
    if (sql.startsWith('select id,created_at from auth.users'))
      return { rows: authMissing ? [] : [{ id: USER, created_at: createdAt }] };
    if (sql.startsWith('select (select count(*)::text'))
      return {
        rows: [
          {
            point_rows: String(pointRows),
            xp_rows: String(xpRows),
            level_rows: String(levels),
            wallet_rows: String(wallets)
          }
        ]
      };
    if (
      sql.startsWith('insert into novelight_formal_private.scout_level_state')
    ) {
      if (levels) return { rows: [] };
      levels++;
      return { rows: [{ user_id: USER }] };
    }
    if (
      sql.startsWith(
        'insert into novelight_formal_private.scout_point_usage_wallets'
      )
    ) {
      if (failWallet) throw Error('synthetic wallet write failure');
      if (wallets) return { rows: [] };
      wallets++;
      return { rows: [{ user_id: USER }] };
    }
    if (sql.startsWith('select count(*)::text as registered_post_release'))
      return {
        rows: [{ registered_post_release: '3', ready: '1', partial: '1' }]
      };
    throw Error('Unexpected SQL: ' + sql);
  };
  const pool = {
    query,
    connect: async () => ({
      query,
      release() {
        released++;
      }
    })
  };
  const client = createUnregisteredFormalNewReaderOnboarding({
    pool,
    ...(stagingProofReference
      ? { stagingTestReferenceAt: RELEASE }
      : { releaseAt: RELEASE }),
    now: () => CLOCK,
    releaseConfiguration: { formalNewReaderOnboardingEnabled: authorized },
    trustedServerAuthorization: authorized ? approval : {}
  });
  return {
    client,
    pool,
    calls,
    get released() {
      return released;
    }
  };
}
test('new post-release reader receives Lv.1 and zero wallet atomically (synthetic client only)', async () => {
  const f = fixture({ authorized: true });
  assert.equal(
    (await f.client.inspectOne(USER)).status,
    'new_reader_ready_for_initialization'
  );
  const result = await f.client.initializeOne(USER);
  assert.equal(result.status, 'new_reader_initialized');
  assert.equal(result.initialLevel, 1);
  assert.equal(result.initialAvailablePoints, 0);
  assert.equal(result.initialExchangeEligiblePoints, 0);
  assert.equal(f.calls.filter((x) => x.sql === 'COMMIT').length, 1);
  assert.equal(
    f.calls.filter((x) => x.sql.startsWith('insert into ')).length,
    2
  );
  assert.equal(
    f.calls.filter(
      (x) =>
        x.sql.includes('public.scout_point_ledger') &&
        x.sql.startsWith('update')
    ).length,
    0
  );
  assert.ok(f.calls.some((x) => x.sql.includes('for update')));
  assert.equal(f.released, 1);
});
test('disabled future release path never opens DB session or writes', async () => {
  const f = fixture();
  assert.equal(
    (await f.client.initializeOne(USER)).status,
    'new_reader_initialization_disabled'
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.released, 0);
});
test('pre-release and missing Auth users cannot onboard or affect legacy IDs', async () => {
  for (const opts of [
    { createdAt: '2026-09-21T00:00:00.000Z' },
    { authMissing: true }
  ]) {
    const f = fixture({ ...opts, authorized: true });
    const result = await f.client.initializeOne(USER);
    assert.match(result.status, /hold$/);
    assert.equal(f.calls.filter((x) => x.sql === 'ROLLBACK').length, 1);
    assert.equal(
      f.calls.filter((x) => x.sql.startsWith('insert into ')).length,
      0
    );
  }
});
test('fresh reader with already-earned Point/XP is held, not rewritten', async () => {
  for (const opts of [{ pointRows: 1 }, { xpRows: 1 }]) {
    const f = fixture({ ...opts, authorized: true });
    assert.equal(
      (await f.client.initializeOne(USER)).status,
      'new_reader_has_prior_activity_hold'
    );
    assert.equal(
      f.calls.filter((x) => x.sql.startsWith('insert into ')).length,
      0
    );
  }
});
test('partial existing state held; complete existing state idempotent with no writes', async () => {
  const partial = fixture({ authorized: true, levelRows: 1 });
  assert.equal(
    (await partial.client.initializeOne(USER)).status,
    'new_reader_partial_state_hold'
  );
  assert.equal(
    partial.calls.filter((x) => x.sql.startsWith('insert into ')).length,
    0
  );
  const complete = fixture({ authorized: true, levelRows: 1, walletRows: 1 });
  assert.equal(
    (await complete.client.initializeOne(USER)).status,
    'new_reader_already_initialized'
  );
  assert.equal(
    complete.calls.filter((x) => x.sql.startsWith('insert into ')).length,
    0
  );
});
test('wallet failure rolls back the entire synthetic Level/wallet operation', async () => {
  const f = fixture({ authorized: true, failWallet: true });
  await assert.rejects(
    f.client.initializeOne(USER),
    /synthetic wallet write failure/
  );
  assert.equal(f.calls.filter((x) => x.sql === 'COMMIT').length, 0);
  assert.equal(f.calls.filter((x) => x.sql === 'ROLLBACK').length, 1);
  assert.equal(f.released, 1);
});
test('new reader admin overview is read-only, counts only post-release registrations', async () => {
  const f = fixture();
  const status = await f.client.getAdminSummary();
  assert.equal(status.totalRegistered, 3);
  assert.equal(status.initialized, 1);
  assert.equal(status.partial, 1);
  assert.equal(status.legacyPointMigrationUnaffected, true);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].sql, /where u.created_at >= \$1::timestamptz/);
});
test('unregistered app factory connects onboarding without enabling or registering route', async () => {
  const f = fixture();
  const app = createUnregisteredFormalApplication({
    pool: f.pool,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) }
    },
    releaseTimestampIso: RELEASE,
    now: () => CLOCK,
    releaseConfiguration: {
      formalRewardsEnabled: false,
      formalNewReaderOnboardingEnabled: false
    },
    trustedServerAuthorization: {},
    unitVerification: {}
  });
  assert.equal(typeof app.inspectNewReader, 'function');
  assert.equal(typeof app.getNewReaderSummary, 'function');
  assert.equal(typeof app.initializeNewReader, 'function');
  assert.equal(
    (await app.initializeNewReader(USER)).status,
    'new_reader_initialization_disabled'
  );
  assert.equal(f.calls.length, 0);
});
test('authenticated reader POST uses verified user ID, rejects forged payload and disabled gate', async () => {
  const ids = [];
  const svc = Object.fromEntries(
    [
      'getReaderSnapshot',
      'requestExchange',
      'requestAiUse',
      'listPendingExchanges',
      'listRefundCandidates',
      'resolveExchange',
      'refundCommitted'
    ].map((x) => [x, async () => ({ status: 'formal_use_disabled' })])
  );
  const handlers = createFormalUsageHttpHandlers({
    supabase: {
      auth: {
        async getUser(token) {
          return {
            data: { user: token === 'test' ? { id: USER } : null },
            error: token === 'test' ? null : Error('unauthorized')
          };
        }
      }
    },
    service: svc,
    env: {},
    initializeNewReader: async (id) => {
      ids.push(id);
      return { status: 'new_reader_initialization_disabled' };
    }
  });
  const send = async (body, token = 'test') => {
    const res = {
      status(v) {
        this.code = v;
        return this;
      },
      setHeader() {},
      json(data) {
        this.body = data;
        return this;
      }
    };
    await handlers.reader(
      {
        method: 'POST',
        body,
        headers: {
          authorization: 'Bearer ' + token,
          origin: 'https://novelight.jp',
          host: 'novelight.jp',
          'x-forwarded-proto': 'https',
          'sec-fetch-site': 'same-origin'
        }
      },
      res
    );
    return res;
  };
  assert.equal(
    (await send({ action: 'initialize_new_formal_reader', userId: USER })).code,
    400
  );
  assert.equal(
    (await send({ action: 'initialize_new_formal_reader' }, 'forged')).code,
    401
  );
  const res = await send({ action: 'initialize_new_formal_reader' });
  assert.equal(res.code, 403);
  assert.deepEqual(ids, [USER]);
});
test('browser transport binds explicit onboarding and admin overview, no automatic POST', async () => {
  const calls = [];
  const scope = { URLSearchParams };
  for (const name of [
    'formal-scout-reward-transport.js',
    'formal-scout-reward-client.js',
    'formal-scout-reward-admin.js'
  ]) {
    const file = readFileSync(
      new URL('../assets/' + name, import.meta.url),
      'utf8'
    );
    runInNewContext(file, scope, { filename: name });
  }
  const request =
    scope.NovelightFormalRewardTransport.createFormalRewardTransport({
      endpoint: '/api/formal-reward-reader',
      getAccessToken: async () => 'test',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            ok: true,
            status:
              options.method === 'POST'
                ? 'new_reader_initialized'
                : 'new_reader_summary_ready'
          })
        };
      }
    });
  const reader =
    scope.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings({
      request,
      nextOperationId: () => USER
    });
  assert.equal(calls.length, 0);
  assert.equal(
    (await reader.initializeNewReader()).status,
    'new_reader_initialized'
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: 'initialize_new_formal_reader'
  });
  const admin = scope.NovelightFormalRewardAdmin.createFormalAdminBindings({
    request
  });
  await admin.loadNewReaderSummary();
  assert.equal(calls[1].url, '/api/formal-reward-reader?view=new_readers');
});

test('one-user proof rejects a different user before opening any DB session', async () => {
  const f = fixture({ authorized: true });
  const other = '22222222-2222-4222-8222-222222222222';
  const result = await f.client.initializeOne(other);
  assert.equal(result.status, 'new_reader_initialization_disabled');
  assert.equal(f.calls.length, 0);
  assert.equal(f.released, 0);
});

test('Staging test reference is distinct from the unconfirmed formal release timestamp', async () => {
  const stagingAuthorization = {
    ...authorization,
    referenceMode: 'staging_synthetic_one_reader_proof'
  };
  const staging = fixture({
    authorized: true,
    stagingProofReference: true,
    approval: stagingAuthorization
  });
  const result = await staging.client.initializeOne(USER);
  assert.equal(result.status, 'new_reader_initialized');
  const summary = await staging.client.getAdminSummary();
  assert.equal(summary.referenceMode, 'staging_synthetic_one_reader_proof');
  assert.equal(summary.referenceAt, RELEASE);
  assert.equal(staging.calls.filter((x) => x.sql === 'COMMIT').length, 1);
});

test('synthetic reference cannot be substituted by formal release authorization', async () => {
  const f = fixture({ authorized: true, stagingProofReference: true });
  assert.equal(
    (await f.client.initializeOne(USER)).status,
    'new_reader_initialization_disabled'
  );
  assert.equal(f.calls.length, 0);
});

test('approval must pin one account, one reference, and maxReaders=1', async () => {
  for (const patch of [
    { approvedUserId: undefined },
    { maxReaders: 2 },
    { approvedReferenceAt: '2027-03-01T00:00:00.000Z' },
    { referenceMode: 'staging_synthetic_one_reader_proof' }
  ]) {
    const f = fixture({
      authorized: true,
      approval: { ...authorization, ...patch }
    });
    assert.equal(
      (await f.client.initializeOne(USER)).status,
      'new_reader_initialization_disabled'
    );
    assert.equal(f.calls.length, 0);
  }
});

test('staging and formal timestamps cannot be supplied together', () => {
  const f = fixture();
  assert.throws(
    () =>
      createUnregisteredFormalNewReaderOnboarding({
        pool: f.pool,
        releaseAt: RELEASE,
        stagingTestReferenceAt: RELEASE
      }),
    /must be separate/
  );
});

test('unregistered application accepts an isolated synthetic Staging reference with release unset', async () => {
  const f = fixture();
  const app = createUnregisteredFormalApplication({
    pool: f.pool,
    supabase: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) }
    },
    stagingTestReferenceAt: RELEASE,
    releaseTimestampIso: undefined,
    now: () => CLOCK,
    stagingRef: 'wmlzjgvxgoyrovdhbqbg',
    releaseConfiguration: {
      formalNewReaderOnboardingEnabled: false,
      formalRewardsEnabled: false,
      formalEarningsEnabled: false,
      productionCutoverApproved: false
    },
    trustedServerAuthorization: {},
    unitVerification: {}
  });
  assert.equal(
    (await app.initializeNewReader(USER)).status,
    'new_reader_initialization_disabled'
  );
  assert.equal(f.calls.length, 0);
});

test('application refuses mixing official release with synthetic Staging proof', () => {
  const f = fixture();
  assert.throws(
    () =>
      createUnregisteredFormalApplication({
        pool: f.pool,
        supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
        releaseTimestampIso: RELEASE,
        stagingTestReferenceAt: RELEASE,
        releaseConfiguration: { formalRewardsEnabled: false },
        trustedServerAuthorization: {},
        unitVerification: {}
      }),
    /must not mix/
  );
  assert.equal(f.calls.length, 0);
});
