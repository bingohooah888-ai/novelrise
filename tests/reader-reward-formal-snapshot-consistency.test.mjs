import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalCanonicalReader } from '../api/_lib/reader-reward/formal-canonical-reader.js';
import { createFormalUsagePostgresRepository } from '../api/_lib/reader-reward/formal-usage-postgres-repository.js';

const USER = '00000000-0000-4000-8000-000000000301';
const ANCHOR = '2027-01-01T00:00:00.000Z';
const CLOCK = Date.parse('2027-01-10T00:00:00.000Z');

function fixture({ ledgerPoints = '50000', failXp = false } = {}) {
  const calls = [];
  let releases = 0;
  let poolQueries = 0;
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK')
      return { rows: [], rowCount: null };
    if (sql.includes('.scout_point_usage_wallets where user_id='))
      return {
        rows: [
          {
            user_id: USER,
            available_points: '50000',
            exchange_eligible_points: '32000',
            reserved_points: '0',
            held_points: '0',
            revision: '2'
          }
        ]
      };
    if (sql.includes('as confirmed_points'))
      return { rows: [{ confirmed_points: ledgerPoints }] };
    if (sql.includes('from novelight_formal_private.scout_level_state'))
      return {
        rows: [
          {
            user_id: USER,
            current_level: '72',
            highest_level: '72',
            level_progress_xp: '120',
            review_anchor_at: ANCHOR,
            last_review_end_at: null,
            revision: '3'
          }
        ]
      };
    if (sql.includes('from public.scout_xp_ledger')) {
      if (failXp) throw new Error('SYNTHETIC_XP_READ_INTERRUPTED');
      return { rows: [{ earned_xp: '220', negative_rows: '0' }] };
    }
    if (sql.includes('from public.scout_point_ledger where user_id='))
      return { rows: [] };
    if (sql.includes('.scout_point_usage_operations')) return { rows: [] };
    throw new Error('UNEXPECTED_SQL_' + sql);
  };
  const pool = {
    query: async () => {
      poolQueries++;
      throw new Error('OUTSIDE_TRANSACTION_READ');
    },
    connect: async () => ({
      query,
      release() {
        releases++;
      }
    })
  };
  const canonicalReader = createFormalCanonicalReader({
    query: pool.query,
    now: () => CLOCK,
    unitVerification: {
      unitVersion: 'beta_ten_points_per_yen',
      cutoverVerifiedByTrustedServer: true,
      canonicalLedgerReconciled: true,
      formalReleaseAt: ANCHOR
    }
  });
  const repo = createFormalUsagePostgresRepository({
    pool,
    canonicalReader,
    readFormalAccount: canonicalReader.readFormalAccount,
    readCanonicalPointHistory: canonicalReader.readCanonicalPointHistory
  });
  return {
    repo,
    calls,
    get poolQueries() {
      return poolQueries;
    },
    get releases() {
      return releases;
    }
  };
}

test('formal reader uses one repeatable-read session for wallet, ledger, XP and history', async () => {
  const f = fixture();
  const state = await f.repo.readReader(USER);
  assert.equal(state.wallet.availablePoints, 50000);
  assert.equal(state.account.level, 72);
  assert.equal(state.account.earnedXpInPeriod, 220);
  assert.deepEqual(state.history, []);
  assert.equal(
    f.calls[0].sql,
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
  );
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.equal(
    f.calls.filter(
      ({ sql }) => sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
    ).length,
    1
  );
  assert.equal(f.poolQueries, 0);
  assert.equal(f.releases, 1);
  assert.ok(f.calls.some(({ sql }) => sql.includes('as confirmed_points')));
  assert.ok(
    f.calls.some(({ sql }) => sql.includes('from public.scout_xp_ledger'))
  );
  assert.ok(
    f.calls.every(
      ({ sql }) => !/^(?:update|insert|delete|alter|drop)/i.test(sql)
    )
  );
});

test('an inconsistent canonical ledger fails within the same snapshot and rolls back', async () => {
  const f = fixture({ ledgerPoints: '50001' });
  await assert.rejects(f.repo.readReader(USER), /MIRROR_OUT_OF_SYNC/);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(f.poolQueries, 0);
  assert.equal(f.releases, 1);
});

test('a failed XP read never returns a partially verified Point snapshot', async () => {
  const f = fixture({ failXp: true });
  await assert.rejects(
    f.repo.readReader(USER),
    /SYNTHETIC_XP_READ_INTERRUPTED/
  );
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(f.releases, 1);
});
