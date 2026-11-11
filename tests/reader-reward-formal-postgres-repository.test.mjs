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
    readCanonicalPointHistory: async () => [{ kind: 'read', points: 6 }],
    canonicalReader: {
      async assertWalletCoherent(userId, wallet) {
        if (wallet.userId !== userId)
          throw new Error('AUTHORITATIVE_OWNER_MISMATCH');
        return { status: 'coherent' };
      }
    }
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
    readCanonicalPointHistory: async () => [],
    canonicalReader: {
      assertWalletCoherent: async () => ({ status: 'coherent' })
    }
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

function settlementFixture({
  phase = 'reserved',
  failOnCanonical = false
} = {}) {
  const calls = [];
  const debitId = '00000000-0000-4000-8000-000000000555';
  const prior = {
    operation_id: operationId,
    user_id: user,
    purpose: 'external_exchange',
    amount_points: '30000',
    phase,
    feature_id: null,
    eligible_reserved_points: '30000',
    revision: phase === 'reserved' ? '1' : '2'
  };
  const wallet = {
    user_id: user,
    available_points: '20000',
    exchange_eligible_points: '2000',
    reserved_points: phase === 'reserved' ? '30000' : '0',
    held_points: '0',
    revision: phase === 'reserved' ? '1' : '2'
  };
  const budget = {
    scope_id: 'gift-development-only',
    limit_points: '100000',
    reserved_points: phase === 'reserved' ? '30000' : '0',
    committed_points: phase === 'reserved' ? '0' : '30000',
    revision: phase === 'reserved' ? '1' : '2'
  };
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (
      failOnCanonical &&
      sql.startsWith('insert into public.scout_point_ledger')
    )
      throw new Error('SYNTHETIC_CANONICAL_WRITE_FAILED');
    if (
      sql.includes('from public.scout_point_ledger') &&
      sql.includes('for update')
    )
      return { rowCount: 1, rows: [{ id: debitId }] };
    if (sql.startsWith('select') && sql.includes('.scout_point_usage_wallets'))
      return { rowCount: 1, rows: [wallet] };
    if (
      sql.startsWith('select') &&
      sql.includes('.scout_point_usage_operations')
    )
      return { rowCount: 1, rows: [prior] };
    if (sql.startsWith('select') && sql.includes('.scout_point_usage_budgets'))
      return { rowCount: 1, rows: [budget] };
    if (sql.startsWith('update ') || sql.startsWith('insert into '))
      return { rowCount: 1, rows: [] };
    return { rowCount: 0, rows: [] };
  };
  const pool = { connect: async () => ({ query, release() {} }), query };
  const repository = createFormalUsagePostgresRepository({
    pool,
    canonicalReader: {
      assertWalletCoherent: async () => ({ status: 'coherent' })
    },
    readFormalAccount: async () => ({ level: 72 }),
    readCanonicalPointHistory: async () => []
  });
  async function apply(phaseAfter) {
    return repository.transact(user, async (tx) => {
      const w = await tx.getWallet(user);
      const o = await tx.getOperation(operationId);
      const b = await tx.getBudget('external_exchange');
      const finalWallet = {
        ...w,
        revision: w.revision + 1,
        availablePoints: phaseAfter === 'refunded' ? 50000 : 20000,
        exchangeEligiblePoints: phaseAfter === 'refunded' ? 32000 : 2000,
        reservedPoints: 0
      };
      const finalBudget = {
        ...b,
        reservedPoints: 0,
        committedPoints: 30000,
        revision: phaseAfter === 'refunded' ? b.revision : b.revision + 1
      };
      const finalOperation = {
        ...o,
        phase: phaseAfter,
        revision: o.revision + 1
      };
      await tx.save({
        wallet: finalWallet,
        budget: finalBudget,
        operation: finalOperation
      });
      return 'ok';
    });
  }
  return { calls, apply, debitId };
}

test('canonical ledger debit is in same PG transaction as approved commit', async () => {
  const f = settlementFixture({ phase: 'reserved' });
  assert.equal(await f.apply('committed'), 'ok');
  const debit = f.calls.find((c) =>
    c.sql.startsWith('insert into public.scout_point_ledger')
  );
  assert.ok(debit);
  assert.equal(debit.values[2], -30000);
  assert.equal(debit.values[3], 'scout-formal-spend:' + operationId);
  assert.equal(f.calls.at(0).sql, 'BEGIN');
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
});

test('refund creates a positive linked canonical reversal without extra budget credit', async () => {
  const f = settlementFixture({ phase: 'committed' });
  await f.apply('refunded');
  const source = f.calls.find(
    (c) =>
      c.sql.includes('from public.scout_point_ledger') &&
      c.sql.includes('for update')
  );
  assert.deepEqual(source.values, [
    user,
    'scout-formal-spend:' + operationId,
    -30000
  ]);
  const refund = f.calls.find((c) =>
    c.sql.startsWith('insert into public.scout_point_ledger')
  );
  assert.equal(refund.values[2], 30000);
  assert.equal(refund.values[3], 'scout-formal-refund:' + operationId);
  assert.equal(refund.values[4], f.debitId);
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
});

test('canonical settlement insert failure rolls back private balances and operation too', async () => {
  const f = settlementFixture({ phase: 'reserved', failOnCanonical: true });
  await assert.rejects(
    f.apply('committed'),
    /SYNTHETIC_CANONICAL_WRITE_FAILED/
  );
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    f.calls.some((c) => c.sql === 'COMMIT'),
    false
  );
});

test('future draft wires formal read, comment, and Level-up credits in one transaction', () => {
  const usage = readFileSync(
    new URL(
      '../docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql',
      import.meta.url
    ),
    'utf8'
  );
  const earn = readFileSync(
    new URL(
      '../docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql',
      import.meta.url
    ),
    'utf8'
  );
  const xp = readFileSync(
    new URL(
      '../docs/drafts/SCOUT_FORMAL_XP_CUTOVER_DRAFT.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(usage, /credit_confirmed_formal_point_draft/);
  assert.match(usage, /scout_point_usage_credit_claims/);
  assert.match(usage, /formal_read_reward','formal_comment_reward/);
  assert.match(
    earn,
    /credit_confirmed_formal_point_draft\(v_inserted,p_release_at\)/
  );
  assert.match(xp, /credit_confirmed_formal_point_draft\(/);
  assert.match(usage, /on conflict\(canonical_point_id\) do nothing/);
});
