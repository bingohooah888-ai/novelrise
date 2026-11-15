import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalReaderSeedEvidenceReader } from '../api/_lib/reader-reward/formal-reader-seed-evidence.js';
import { createFormalRewardUsageService } from '../api/_lib/reader-reward/formal-usage-service.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SEED = '33333333-3333-4333-8333-333333333333';
const EVENT_A = '44444444-4444-4444-8444-444444444444';
const EVENT_B = '55555555-5555-4555-8555-555555555555';
const EXPIRES = '2026-11-20T00:00:00.000Z';
const NOW = '2026-11-15T00:00:00.000Z';

const seedRow = {
  seed_id: SEED,
  reader_id: USER,
  seed_type: 'GOLD',
  rank_at_seed: 1,
  highest_rank_seen: 4,
  best_rank_delta: 3,
  window_expires_at: EXPIRES,
  updated_at: NOW,
  novel_title: '発見した作品'
};
const eventA = {
  id: EVENT_A,
  seed_id: SEED,
  user_id: USER,
  event_seed_type: 'GOLD',
  event_rank_at_seed: '1',
  reached_rank: '3',
  proposed_delta_xp: '300',
  occurred_at: NOW,
  credited_xp: '120'
};
const eventB = {
  ...eventA,
  id: EVENT_B,
  reached_rank: '4',
  proposed_delta_xp: '300',
  credited_xp: null
};
function fixture(seeds = [seedRow], events = [eventA, eventB]) {
  const calls = [];
  const reader = createFormalReaderSeedEvidenceReader({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('from public.seed_discovery_state')) {
        return { rows: seeds };
      }
      if (sql.includes('from public.scout_event_ledger')) {
        return { rows: events };
      }
      throw Error('UNEXPECTED_SQL');
    }
  });
  return { reader, calls };
}

test('reader sees SEED stages and only ACTUAL ledger-credited XP, never capped theoretical XP', async () => {
  const { reader, calls } = fixture();
  const result = await reader.read(USER);
  assert.equal(result.status, 'formal_reader_seed_evidence_review_only');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].grade, 'GOLD');
  assert.equal(result.items[0].growth, 3);
  assert.equal(result.items[0].workTitle, '発見した作品');
  assert.deepEqual(
    result.items[0].stages.map((stage) => stage.stage),
    ['growth_2', 'growth_3']
  );
  assert.equal(result.items[0].recordedCreditedXp, 120);
  assert.equal(result.items[0].missingXpEvidenceEvents, 1);
  assert.equal(result.items[0].stages[0].ledgerCreditedXp, 120);
  assert.equal(result.items[0].stages[0].claimedDeltaMatchesLedger, false);
  assert.equal(result.items[0].stages[1].ledgerCreditedXp, null);
  assert.equal(result.items[0].stages[1].creditLedgerVerified, false);
  assert.equal(result.historicalXpBackfillAllowed, false);
  assert.equal(result.mayIssueXp, false);
  assert.equal(result.independentlyVerifiedEntireLedger, false);
  assert.equal(result.readyForPublicRelease, false);
  assert.equal(JSON.stringify(result).includes('"rankAtSeed"'), false);
  assert.equal(JSON.stringify(result).includes('"highestRankSeen"'), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, [USER]);
  assert.deepEqual(calls[1].params, [USER, [SEED]]);
  assert.match(calls[0].sql, /s.reader_id=\$1::uuid/);
  assert.match(calls[1].sql, /e.user_id=\$1::uuid/);
  assert.match(calls[1].sql, /e.seed_id=any\(\$2::uuid\[\]\)/);
  assert.match(calls[1].sql, /x.source_event_id=e.id/);
  assert.match(calls[1].sql, /x.xp_kind='light_seed_discovery'/);
  assert.doesNotMatch(
    calls.map((call) => call.sql).join(' '),
    /\b(insert|update|delete|alter|drop|truncate)\b/i
  );
});

test('NOVA prediction stays a private stage, and hidden work title is not revealed', async () => {
  const seeded = {
    ...seedRow,
    seed_type: 'BRONZE',
    rank_at_seed: 5,
    highest_rank_seen: 6,
    best_rank_delta: 1,
    novel_title: null
  };
  const event = {
    ...eventA,
    event_seed_type: 'BRONZE',
    event_rank_at_seed: '5',
    reached_rank: '6',
    proposed_delta_xp: '80',
    credited_xp: '80'
  };
  const result = await fixture([seeded], [event]).reader.read(USER);
  assert.equal(result.items[0].novaPrediction, true);
  assert.equal(result.items[0].stages[0].stage, 'NOVA_prediction');
  assert.equal(result.items[0].recordedCreditedXp, 80);
  assert.equal(result.items[0].workTitle, null);
});

test('no verified reader ID means no SQL, and an empty account never invents rewards', async () => {
  const { reader, calls } = fixture([], []);
  await assert.rejects(() => reader.read('not-a-uuid'));
  assert.equal(calls.length, 0);
  const result = await reader.read(USER);
  assert.deepEqual(result.items, []);
  assert.equal(calls.length, 1);
});

test('cross-reader data, fabricated stage, out-of-window event and duplicate XP source fail closed', async () => {
  await assert.rejects(() =>
    fixture([{ ...seedRow, reader_id: OTHER }]).reader.read(USER)
  );
  await assert.rejects(() =>
    fixture([seedRow], [{ ...eventA, user_id: OTHER }]).reader.read(USER)
  );
  await assert.rejects(() =>
    fixture([seedRow], [{ ...eventA, reached_rank: '2' }]).reader.read(USER)
  );
  await assert.rejects(() =>
    fixture([seedRow], [{ ...eventA, credited_xp: '301' }]).reader.read(USER)
  );
  await assert.rejects(() =>
    fixture([seedRow], [
      { ...eventA, occurred_at: '2027-01-01T00:00:00Z' }
    ]).reader.read(USER)
  );
  await assert.rejects(() =>
    fixture([seedRow], [eventA, eventA]).reader.read(USER)
  );
  await assert.rejects(() =>
    fixture([seedRow], [{ ...eventA, event_seed_type: 'SILVER' }]).reader.read(USER)
  );
});

test('pagination is explicit, and oversized event history cannot pretend completeness', async () => {
  const seeds = Array.from({ length: 61 }, (_, index) => ({
    ...seedRow,
    seed_id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')
  }));
  const result = await fixture(seeds, []).reader.read(USER);
  assert.equal(result.items.length, 60);
  assert.equal(result.moreSeedsAvailable, true);
  const events = Array.from({ length: 501 }, (_, index) => ({
    ...eventA,
    id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')
  }));
  await assert.rejects(
    () => fixture([seedRow], events).reader.read(USER),
    /FORMAL_READER_SEED_EVENT_HISTORY_TRUNCATED/
  );
});

test('existing formal snapshot keeps seed evidence OFF until canonical release gates pass', async () => {
  const calls = [];
  const repository = {
    transact: async () => {
      throw Error('UNAUTHORIZED_MUTATION');
    },
    readReader: async (id) => ({
      wallet: { availablePoints: 0, exchangeEligiblePoints: 0 },
      account: { level: 30 },
      history: [],
      owner: id
    }),
    listPendingExchanges: async () => [],
    findOperation: async () => null
  };
  const seedEvidence = { status: 'formal_reader_seed_evidence_review_only', items: [] };
  const make = (approved) =>
    createFormalRewardUsageService({
      repository,
      releaseConfiguration: {
        formalRewardsEnabled: approved,
        productionCutoverApproved: approved
      },
      trustedServerAuthorization: {
        verifiedByTrustedServer: approved,
        serviceRoleVerified: approved
      },
      getReaderSeedEvidence: async (id) => {
        calls.push(id);
        return seedEvidence;
      }
    });
  const dormant = await make(false).getReaderSnapshot(USER);
  assert.equal(dormant.seedEvidence, null);
  assert.equal(dormant.formalEnabled, false);
  assert.equal(calls.length, 0);
  const syntheticApproved = await make(true).getReaderSnapshot(USER);
  assert.equal(syntheticApproved.seedEvidence, seedEvidence);
  assert.equal(syntheticApproved.formalEnabled, true);
  assert.deepEqual(calls, [USER]);
});
