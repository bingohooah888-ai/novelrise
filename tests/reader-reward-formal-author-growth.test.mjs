import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalAuthorGrowthReader } from '../api/_lib/reader-reward/formal-author-growth-reader.js';

const USER = '11111111-1111-4111-8111-111111111111';
const TIME = '2026-11-15T00:00:00Z';
const work = {
  novel_id_snapshot: '121',
  title: '作者だけが見る作品',
  current_rank: 4,
  peak_rank: 5,
  last_rank_changed_at: TIME,
  is_completed: false
};
const event = {
  novel_id_snapshot: '121',
  from_rank: 3,
  to_rank: 4,
  event_type: 'promotion',
  occurred_at: TIME
};
const received = {
  novel_id_snapshot: '121',
  total_count: '3',
  gold_count: '1',
  silver_count: '1',
  bronze_count: '0',
  legacy_count: '1'
};
function setup(works = [work], events = [event], seedSummaries = [received]) {
  const calls = [];
  const reader = createFormalAuthorGrowthReader({
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes('novel_rank_state')) return { rows: works };
      if (sql.includes('novel_rank_events')) return { rows: events };
      if (sql.includes('from public.novels n left join public.light_seeds s'))
        return { rows: seedSummaries };
      throw Error('Unexpected SQL');
    }
  });
  return { reader, calls };
}

test('author sees only their owned work Rank and authoritative growth events', async () => {
  const { reader, calls } = setup();
  const result = await reader.read(USER);
  assert.equal(result.works[0].rank, 4);
  assert.equal(result.works[0].rankName, 'BEACON');
  assert.equal(result.works[0].peakRank, 5);
  assert.equal(result.events[0].type, 'promotion');
  assert.equal(result.events[0].fromRank, 3);
  assert.equal(result.events[0].toRank, 4);
  assert.deepEqual(result.works[0].receivedSeeds, {
    total: 3,
    gold: 1,
    silver: 1,
    bronze: 0,
    legacy: 1
  });
  assert.equal(calls.length, 3);
  for (const call of calls.slice(0, 2)) {
    assert.deepEqual(call.args, [USER]);
    assert.match(call.sql, /n\.user_id=.*author_id_snapshot/);
    assert.match(call.sql, /author_id_snapshot=\$1::uuid/);
  }
  assert.deepEqual(calls[2].args, [USER, ['121']]);
  assert.match(calls[2].sql, /n\.user_id=\$1::uuid/);
  assert.match(calls[2].sql, /n\.id::text=any\(\$2::text\[\]\)/);
  assert.match(calls[2].sql, /s\.author_id_snapshot=n\.user_id/);
  assert.match(calls[2].sql, /s\.id is not null/);
  for (const call of calls)
    assert.doesNotMatch(call.sql, /\b(insert|update|delete|alter|drop)\b/i);
});

test('invalid author ID is rejected before reading from database', async () => {
  const { reader, calls } = setup();
  await assert.rejects(() => reader.read('invalid'), TypeError);
  assert.equal(calls.length, 0);
});

test('Rank validation rejects invented transitions, author names and unexpected data', async () => {
  for (const invalid of [
    { ...work, current_rank: 7 },
    { ...work, peak_rank: 3 },
    { ...work, title: null },
    { ...work, is_completed: null }
  ]) {
    await assert.rejects(() => setup([invalid]).reader.read(USER));
  }
  await assert.rejects(() =>
    setup([work], [{ ...event, event_type: 'unexpected' }]).reader.read(USER)
  );
});

test('no work or events is a valid empty author account', async () => {
  const { reader } = setup([], []);
  const result = await reader.read(USER);
  assert.deepEqual(result.works, []);
  assert.deepEqual(result.events, []);
});

test('missing, duplicate, foreign or inconsistent received SEED counts fail closed', async () => {
  for (const rows of [
    [],
    [received, received],
    [{ ...received, novel_id_snapshot: '999' }],
    [{ ...received, gold_count: '-1' }],
    [{ ...received, gold_count: '2' }],
    [{ ...received, total_count: '9007199254740992' }]
  ]) {
    await assert.rejects(() => setup([work], [event], rows).reader.read(USER));
  }
});

test('no owned work does not run received SEED query or infer private statistics', async () => {
  const { reader, calls } = setup([], []);
  const result = await reader.read(USER);
  assert.deepEqual(result.works, []);
  assert.equal(calls.length, 2);
  assert.equal(
    calls.some((c) => c.sql.includes('light_seeds')),
    false
  );
});

test('legacy/null seed types stay explicit and are never guessed from Rank', async () => {
  const rows = [
    {
      ...received,
      total_count: '2',
      gold_count: '0',
      silver_count: '0',
      bronze_count: '0',
      legacy_count: '2'
    }
  ];
  const result = await setup([work], [event], rows).reader.read(USER);
  assert.equal(result.works[0].rank, 4);
  assert.equal(result.works[0].receivedSeeds.legacy, 2);
  assert.equal(result.works[0].receivedSeeds.gold, 0);
});
