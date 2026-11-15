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
function setup(works = [work], events = [event]) {
  const calls = [];
  const reader = createFormalAuthorGrowthReader({
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes('novel_rank_state')) return { rows: works };
      if (sql.includes('novel_rank_events')) return { rows: events };
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
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.args, [USER]);
    assert.match(call.sql, /n\.user_id=.*author_id_snapshot/);
    assert.match(call.sql, /author_id_snapshot=\$1::uuid/);
    assert.doesNotMatch(call.sql, /\b(insert|update|delete|alter|drop)\b/i);
  }
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
