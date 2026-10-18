import assert from 'node:assert/strict';
import test from 'node:test';

import { createContestReaderReadyHandler } from '../api/november-contest-reader-ready.js';

const START = Date.parse('2026-10-31T15:00:00Z');
const END = Date.parse('2026-11-30T15:00:00Z');
const env = {
  NOVELIGHT_CONTEST_READING_ENABLED: 'true',
  NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET: 'contest-guest-signature-purpose-32-bytes-strong',
  SUPABASE_SECRET_KEY: 'different-service-key'
};

function response() {
  return {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

function fixture({
  contestStatus = 'active',
  publicVisible = true,
  episodeStatus = 'published',
  entered = true,
  databaseError = false,
  startedAt = START,
  endsAt = END,
  timestamp = START + 5000,
  settings = env
} = {}) {
  const queries = [];
  const getDatabase = () => ({
    from(table) {
      const filters = [];
      const builder = {
        select() {
          return this;
        },
        eq(name, value) {
          filters.push([name, value]);
          return this;
        },
        async maybeSingle() {
          queries.push({ table, filters });
          if (databaseError) throw new Error('database unavailable');
          if (table === 'novelight_contests') {
            return {
              data: {
                id: 'contest-id',
                status: contestStatus,
                public_visible: publicVisible,
                starts_at: new Date(startedAt).toISOString(),
                ends_at: new Date(endsAt).toISOString()
              },
              error: null
            };
          }
          if (table === 'episodes') {
            return {
              data: { novel_id: 'novel-id', status: episodeStatus },
              error: null
            };
          }
          if (table === 'novelight_contest_entries') {
            return { data: entered ? { id: 'entry-id' } : null, error: null };
          }
          throw Error('unexpected database query');
        }
      };
      return builder;
    }
  });
  const handler = createContestReaderReadyHandler({
    getDatabase,
    env: settings,
    now: () => timestamp
  });
  async function check(id = '123') {
    const res = response();
    await handler({ method: 'GET', query: { episode_id: id } }, res);
    return res;
  }
  return { check, queries, handler };
}

test('probe refuses premature launch without consulting user data', async () => {
  const disabled = fixture({
    settings: { ...env, NOVELIGHT_CONTEST_READING_ENABLED: 'false' }
  });
  const secretMissing = fixture({
    settings: { ...env, NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET: '' }
  });
  for (const f of [disabled, secretMissing]) {
    const res = await f.check();
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { enabled: false });
    assert.equal(f.queries.length, 0);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  }
  for (const f of [
    fixture({ contestStatus: 'registration' }),
    fixture({ publicVisible: false }),
    fixture({ timestamp: START - 1 }),
    fixture({ timestamp: END })
  ]) {
    const res = await f.check();
    assert.deepEqual(res.body, { enabled: false });
    assert.equal(f.queries.length, 1, 'inactive contest stops at launch gate');
  }
});

test('only published entered episodes are enabled after owner-start', async () => {
  const eligible = fixture();
  const response = await eligible.check();
  assert.deepEqual(response.body, { enabled: true });
  assert.deepEqual(
    eligible.queries.map((query) => query.table),
    ['novelight_contests', 'episodes', 'novelight_contest_entries']
  );
  assert.deepEqual(eligible.queries[2].filters, [
    ['contest_id', 'contest-id'],
    ['novel_id', 'novel-id'],
    ['status', 'entered']
  ]);

  for (const f of [
    fixture({ episodeStatus: 'draft' }),
    fixture({ entered: false }),
    fixture({ databaseError: true })
  ]) {
    assert.deepEqual((await f.check()).body, { enabled: false });
  }
});

test('invalid IDs and non-GET methods never create contest sessions', async () => {
  const f = fixture();
  for (const id of [null, '0', '-1', 'abc', '2 OR true', '9'.repeat(25)]) {
    assert.deepEqual((await f.check(id)).body, { enabled: false });
  }
  const res = response();
  await f.handler({ method: 'POST', query: { episode_id: '123' } }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(f.queries.length, 0);
});
