import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createFormalUsagePostgresRepository } from '../api/_lib/reader-reward/formal-usage-postgres-repository.js';
import { createFormalRewardUsageService } from '../api/_lib/reader-reward/formal-usage-service.js';
import { createUnregisteredFormalPostgresRewardHost } from '../api/_lib/reader-reward/formal-usage-host.js';

const user = '00000000-0000-4000-8000-000000000301';
const operationId = '00000000-0000-4000-8000-000000000311';
const allow = Object.freeze({
  budget: true,
  eligibility: true,
  risk: true,
  channel: true,
  aiPrice: true
});
function fakePg({ failOn, invalidWallet = false } = {}) {
  const calls = [];
  let released = false;
  const walletRow = {
    user_id: user,
    available_points: invalidWallet ? 'abc' : '50000',
    exchange_eligible_points: '32000',
    reserved_points: '0',
    held_points: '0',
    revision: '0'
  };
  const budgetRow = {
    purpose: 'external_exchange',
    scope_id: 'gift-development-only',
    limit_points: '100000',
    committed_points: '0',
    reserved_points: '0',
    revision: '0'
  };
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (typeof failOn === 'string' && sql.includes(failOn))
      throw new Error('SYNTHETIC_DATABASE_INTERRUPTED');
    if (
      sql.includes('.scout_point_usage_wallets') &&
      sql.trimStart().startsWith('select')
    )
      return { rows: [walletRow], rowCount: 1 };
    if (
      sql.includes('.scout_point_usage_budgets') &&
      sql.trimStart().startsWith('select')
    )
      return { rows: [budgetRow], rowCount: 1 };
    if (
      sql.includes('.scout_point_usage_operations') &&
      sql.trimStart().startsWith('select')
    )
      return { rows: [], rowCount: 0 };
    if (
      sql.includes('.scout_point_usage_operations') &&
      sql.trimStart().startsWith('insert')
    )
      return { rows: [], rowCount: 1 };
    if (
      sql.trimStart().startsWith('update') ||
      sql.includes('.scout_point_usage_events')
    )
      return { rows: [], rowCount: 1 };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql))
      return { rows: [], rowCount: null };
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    connect: async () => ({
      query,
      release() {
        released = true;
      }
    }),
    query
  };
  return {
    pool,
    calls,
    get released() {
      return released;
    }
  };
}
function repo(f) {
  return createFormalUsagePostgresRepository({
    pool: f.pool,
    readFormalAccount: async () => ({
      level: 72,
      progressXp: 100,
      requiredXp: 400
    }),
    readCanonicalPointHistory: async () => [{ kind: 'read', points: 6 }]
  });
}
function service(repository) {
  return createFormalRewardUsageService({
    repository,
    releaseConfiguration: {
      formalRewardsEnabled: true,
      productionCutoverApproved: true
    },
    trustedServerAuthorization: {
      verifiedByTrustedServer: true,
      serviceRoleVerified: true
    },
    policy: { giftProviderReady: true, verifyExchange: async () => allow }
  });
}

test('formal SQL draft is not migration; RLS/private ACL and append-only events are present', () => {
  const path = new URL(
    '../docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql',
    import.meta.url
  );
  const sql = readFileSync(path, 'utf8');
  assert.match(sql, /NOT A SUPABASE MIGRATION/);
  assert.match(sql, /enable row level security/g);
  assert.match(
    sql,
    /revoke all on schema novelight_formal_private from public, anon, authenticated/i
  );
  assert.match(sql, /scout_point_usage_events/);
  assert.ok(sql.includes('unique (operation_id, phase)'));
  assert.match(sql, /amount_points >= 30000/);
  assert.match(sql, /exchange_eligible_points <= available_points/);
  assert.doesNotMatch(sql, /grant .* to authenticated/i);
});

test('Postgres adapter performs wallet/budget/operation/event writes in one private transaction', async () => {
  const f = fakePg();
  const result = await service(repo(f)).requestExchange({
    userId: user,
    operationId,
    amountPoints: 30000
  });
  assert.equal(result.status, 'request_received');
  assert.equal(f.calls[0].sql, 'BEGIN');
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.equal(f.released, true);
  assert.equal(f.calls.filter((c) => c.sql.includes('for update')).length, 3);
  for (const name of [
    '.scout_point_usage_wallets',
    '.scout_point_usage_budgets',
    '.scout_point_usage_operations',
    '.scout_point_usage_events'
  ]) {
    assert.ok(
      f.calls.some(
        (c) =>
          c.sql.includes(name) &&
          (c.sql.startsWith('update ') || c.sql.startsWith('insert into '))
      )
    );
  }
  assert.ok(
    f.calls.every((c) => !c.sql.includes(user) && !c.sql.includes(operationId))
  );
  assert.ok(f.calls.some((c) => c.values.includes(operationId)));
});

test('DB failure rolls back reservation, never returns a successful approval', async () => {
  const f = fakePg({
    failOn: 'update novelight_formal_private.scout_point_usage_budgets'
  });
  await assert.rejects(
    service(repo(f)).requestExchange({
      userId: user,
      operationId,
      amountPoints: 30000
    }),
    /SYNTHETIC_DATABASE_INTERRUPTED/
  );
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!f.calls.some((c) => c.sql === 'COMMIT'));
  assert.equal(f.released, true);
});

test('invalid authoritative Point integer fails before any mutation', async () => {
  const f = fakePg({ invalidWallet: true });
  await assert.rejects(
    service(repo(f)).requestExchange({
      userId: user,
      operationId,
      amountPoints: 30000
    }),
    /Invalid formal Point integer/
  );
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!f.calls.some((c) => c.sql.startsWith('update ')));
});

test('reader view requires server-side formal account and canonical ledger provider', async () => {
  const f = fakePg();
  const r = repo(f);
  const state = await r.readReader(user);
  assert.equal(state.wallet.availablePoints, 50000);
  assert.equal(state.account.level, 72);
  assert.equal(state.history[0].points, 6);
  const lacking = createFormalUsagePostgresRepository({
    pool: f.pool,
    readFormalAccount: async () => null,
    readCanonicalPointHistory: async () => []
  });
  await assert.rejects(
    lacking.readReader(user),
    /AUTHORITATIVE_READER_UNAVAILABLE/
  );
});

test('Postgres host only constructs dormant reader/admin factories without connecting', async () => {
  let connects = 0;
  const f = fakePg();
  const wrapped = {
    ...f.pool,
    connect: async () => {
      connects++;
      return f.pool.connect();
    }
  };
  const host = createUnregisteredFormalPostgresRewardHost({
    pool: wrapped,
    readFormalAccount: async () => ({}),
    readCanonicalPointHistory: async () => [],
    supabase: {
      auth: { getUser: async () => ({ data: { user: null }, error: true }) }
    },
    releaseConfiguration: { formalRewardsEnabled: false },
    trustedServerAuthorization: {},
    catalog: []
  });
  assert.equal(typeof host.handlers.reader, 'function');
  assert.equal(typeof host.handlers.admin, 'function');
  assert.equal(connects, 0);
  assert.equal(
    (
      await host.service.requestExchange({
        userId: user,
        operationId,
        amountPoints: 30000
      })
    ).status,
    'formal_use_disabled'
  );
  assert.equal(connects, 0);
});
