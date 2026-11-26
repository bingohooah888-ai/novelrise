import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalScoutOverviewReader } from '../api/_lib/reader-reward/formal-scout-overview-reader.js';

const USER = '11111111-1111-4111-8111-111111111111';
const time = '2026-11-15T00:00:00.000Z';
const badge = {
  badge_id: 'reader_seed_001',
  badge_category: 'reader',
  difficulty: 'easy',
  display_name: 'SEEDBEARER',
  target_value: '1',
  is_hidden: false,
  enabled: true,
  progress_value: '1',
  status: 'earned',
  earned_at: time
};
const seed = {
  seed_type: 'GOLD',
  best_rank_delta: 2,
  rank_at_seed: 1,
  highest_rank_seen: 3,
  window_expires_at: time,
  updated_at: time,
  novel_title: '発掘された作品'
};
function reader({ badges = [badge], seeds = [seed] } = {}) {
  const calls = [];
  return {
    calls,
    service: createFormalScoutOverviewReader({
      query: async (sql, args) => {
        calls.push({ sql, args });
        if (sql.includes('scout_badge_definitions')) return { rows: badges };
        if (sql.includes('seed_discovery_state')) return { rows: seeds };
        throw Error('UNEXPECTED_QUERY');
      }
    })
  };
}
test('existing canonical title/SEED tables feed verified reader overview without writing', async () => {
  const { calls, service } = reader();
  const result = await service.read(USER);
  assert.equal(result.badges.length, 1);
  assert.equal(result.badges[0].earned, true);
  assert.equal(result.badges[0].name, 'SEEDBEARER');
  assert.equal(result.seeds.length, 1);
  assert.equal(result.seeds[0].growth, 2);
  assert.equal(result.seeds[0].type, 'GOLD');
  assert.equal(result.seeds[0].workTitle, '発掘された作品');
  assert.equal(Object.hasOwn(result.seeds[0], 'rankAtSeed'), false);
  assert.equal(Object.hasOwn(result.seeds[0], 'highestRankSeen'), false);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.args, [USER]);
    assert.match(call.sql, /where/i);
    assert.doesNotMatch(
      call.sql,
      /\b(insert|update|delete|create|alter|drop)\b/i
    );
  }
});
test('unverified identity cannot cause any query', async () => {
  const r = reader();
  await assert.rejects(() => r.service.read('untrusted'), TypeError);
  assert.equal(r.calls.length, 0);
});
test('unearned hidden title stays masked, disabled title remains unawarded', async () => {
  const r = reader({
    badges: [
      {
        ...badge,
        badge_id: 'reader_secret_001',
        display_name: 'SECRET NAME',
        is_hidden: true,
        enabled: false,
        status: 'in_progress',
        earned_at: null,
        progress_value: '0'
      }
    ]
  });
  const result = await r.service.read(USER);
  assert.equal(result.badges[0].name, '???');
  assert.equal(result.badges[0].enabled, false);
  assert.equal(result.badges[0].earned, false);
});
test('NOVA prediction is derived server-side without exposing hidden Rank', async () => {
  const r = reader({
    seeds: [
      {
        ...seed,
        seed_type: 'BRONZE',
        rank_at_seed: 5,
        highest_rank_seen: 6,
        best_rank_delta: 1,
        novel_title: null
      }
    ]
  });
  const result = await r.service.read(USER);
  assert.equal(result.seeds[0].novaPrediction, true);
  assert.equal(result.seeds[0].workTitle, null);
  assert.equal(result.seeds[0].growth, 1);
});
test('invalid database rows fail closed instead of fabricating an achievement', async () => {
  for (const badges of [[{ ...badge, progress_value: '-1' }], [badge, badge]]) {
    await assert.rejects(() => reader({ badges }).service.read(USER));
  }
  await assert.rejects(() =>
    reader({
      seeds: [{ ...seed, best_rank_delta: 4, highest_rank_seen: 3 }]
    }).service.read(USER)
  );
  await assert.rejects(() =>
    reader({
      seeds: [{ ...seed, seed_type: 'OTHER' }]
    }).service.read(USER)
  );
});

test('reader badge catalog detects definitions beyond 100 instead of hiding overflow', async () => {
  const badges = Array.from({ length: 101 }, (_, index) => ({
    ...badge,
    badge_id: 'reader_oversized_' + String(index).padStart(3, '0')
  }));
  const r = reader({ badges });
  await assert.rejects(
    () => r.service.read(USER),
    /SCOUT_OVERVIEW_SOURCE_UNAVAILABLE/
  );
  assert.match(r.calls[0].sql, /limit 101$/);
});
