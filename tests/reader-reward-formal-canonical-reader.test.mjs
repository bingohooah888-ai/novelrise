import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalCanonicalReader } from '../api/_lib/reader-reward/formal-canonical-reader.js';

const user = '00000000-0000-4000-8000-000000000301';
const pointId = '00000000-0000-4000-8000-000000000320';
const reversalId = '00000000-0000-4000-8000-000000000321';
const nowMs = Date.parse('2027-01-15T00:00:00Z');
const anchor = '2027-01-01T00:00:00Z';
const approved = Object.freeze({
  unitVersion: 'beta_ten_points_per_yen',
  cutoverVerifiedByTrustedServer: true,
  canonicalLedgerReconciled: true,
  formalReleaseAt: anchor
});
function createFixture({
  level = 72,
  points = 50000,
  adjustments = false,
  release = approved,
  reviewedAt = null,
  now = nowMs,
  badRevision = false
} = {}) {
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes('sum(point_value)'))
      return { rows: [{ confirmed_points: String(points) }] };
    if (sql.includes('from novelight_formal_private.scout_level_state'))
      return {
        rows: [
          {
            user_id: user,
            current_level: String(level),
            highest_level: String(level),
            level_progress_xp: '220',
            review_anchor_at: anchor,
            last_review_end_at: reviewedAt,
            revision: badRevision ? '-1' : '3'
          }
        ]
      };
    if (sql.includes('from public.scout_level_thresholds'))
      return {
        rows: [
          { level: '10', cumulative_xp: '1350' },
          { level: '11', cumulative_xp: '1550' }
        ]
      };
    if (sql.includes('sum(xp_value)'))
      return {
        rows: [
          {
            earned_xp: '180',
            negative_rows: adjustments ? '1' : '0'
          }
        ]
      };
    if (
      sql.includes('from public.scout_point_ledger') &&
      sql.includes('order by')
    )
      return {
        rows: [
          {
            id: pointId,
            point_kind: 'formal_read_reward',
            point_value: '5',
            status: 'confirmed',
            occurred_at: '2027-01-10T00:00:00Z',
            reversal_of: null
          },
          {
            id: reversalId,
            point_kind: 'formal_external_exchange_refund',
            point_value: '30000',
            status: 'confirmed',
            occurred_at: '2027-01-12T00:00:00Z',
            reversal_of: pointId
          }
        ]
      };
    throw new Error('UNKNOWN_QUERY');
  };
  const reader = createFormalCanonicalReader({
    query,
    unitVerification: release,
    now: () => now
  });
  return { reader, calls };
}
test('formal private state renders Level72, next 400 XP and 30-day maintenance progress', async () => {
  const f = createFixture();
  const state = await f.reader.readFormalAccount(user);
  assert.equal(state.level, 72);
  assert.equal(state.requiredXp, 400);
  assert.equal(state.progressXp, 220);
  assert.equal(state.earnedXpInPeriod, 180);
  assert.equal(state.maintenanceXpTarget, 200);
  assert.equal(state.nextMaintenanceAt, '2027-01-31T00:00:00.000Z');
  assert.ok(
    f.calls.some(
      (c) =>
        c.sql.includes('from public.scout_xp_ledger') && c.values[0] === user
    )
  );
});

test('Lv100 remains capped and does not request a nonexistent Lv101 threshold', async () => {
  const s = await createFixture({ level: 100 }).reader.readFormalAccount(user);
  assert.equal(s.level, 100);
  assert.equal(s.requiredXp, null);
});

test('wallet uses canonical confirmed net minus current reservations, no points without cutover witness', async () => {
  const f = createFixture();
  assert.equal(
    (
      await f.reader.assertWalletCoherent(user, {
        userId: user,
        availablePoints: 20000,
        reservedPoints: 30000
      })
    ).status,
    'coherent'
  );
  await assert.rejects(
    f.reader.assertWalletCoherent(user, {
      userId: user,
      availablePoints: 50001,
      reservedPoints: 0
    }),
    /MIRROR_OUT_OF_SYNC/
  );
  await assert.rejects(
    createFixture({
      release: { ...approved, cutoverVerifiedByTrustedServer: false }
    }).reader.readCanonicalBalance(user),
    /CUTOVER_UNVERIFIED/
  );
});

test('formal XP state rejects overdue review and adjusted XP without guessing maintenance', async () => {
  await assert.rejects(
    createFixture({
      now: Date.parse('2027-02-01T00:00:00Z')
    }).reader.readFormalAccount(user),
    /REVIEW_DUE/
  );
  await assert.rejects(
    createFixture({
      adjustments: true
    }).reader.readFormalAccount(user),
    /ADJUSTMENT_REVIEW_PENDING/
  );
  await assert.rejects(
    createFixture({
      badRevision: true
    }).reader.readFormalAccount(user),
    /Invalid authoritative Level revision/
  );
});

test('canonical history shows original debit and refund as separate source-linked events', async () => {
  const list = await createFixture().reader.readCanonicalPointHistory(user);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'read');
  assert.equal(list[1].kind, 'refund');
  assert.equal(list[1].points, 30000);
  assert.equal(list[1].status, 'confirmed');
});
