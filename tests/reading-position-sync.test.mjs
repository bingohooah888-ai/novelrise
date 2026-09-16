import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const syncSource = await readFile('novelight-reading-sync.js', 'utf8');
const continuitySource = await readFile('novelight-reading-continuity.js', 'utf8');
const homeSource = await readFile('novelight-home-resume.js', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260917030000_reader_reading_position_sync.sql',
  'utf8'
);

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function loadSyncApi(storage = createStorage()) {
  const window = { localStorage: storage };
  vm.runInNewContext(syncSource, {
    window,
    console,
    Date,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Set,
    String
  });
  return window.NovelightReadingSync;
}

test('reading sync chooses the newest position while retaining revision conflict state', () => {
  const api = loadSyncApi();
  const older = {
    novelId: '10',
    episodeId: '100',
    episodeNumber: 1,
    progressRatio: 0.7,
    lastReadAt: '2026-09-17T01:00:00.000Z',
    serverRevision: 4
  };
  const newer = {
    ...older,
    episodeId: '101',
    episodeNumber: 2,
    progressRatio: 0.2,
    lastReadAt: '2026-09-17T01:05:00.000Z',
    serverRevision: 5
  };

  assert.equal(api.compareProgress(newer, older), 1);
  assert.equal(api.chooseNewest(older, newer).episodeId, '101');
  assert.equal(api.normalizeProgress(newer).serverRevision, 5);
});

test('reading sync keeps anonymous/local fallback and isolates server state from scoring systems', () => {
  assert.match(syncSource, /novelight:reading:v1:/);
  assert.match(syncSource, /reader_reading_positions/);
  assert.match(syncSource, /auth\.getSession\(\)/);
  assert.match(syncSource, /\.upsert\(payload, \{ onConflict: 'user_id,novel_id' \}\)/);
  assert.match(syncSource, /serverRevision/);
  assert.doesNotMatch(syncSource, /record_valid_read_progress/);
  assert.doesNotMatch(syncSource, /valid_read_events/);
  assert.doesNotMatch(syncSource, /light_seed/i);
  assert.doesNotMatch(syncSource, /scout/i);
  assert.doesNotMatch(syncSource, /work_rank/i);
});

test('reader continuity and home resume hydrate synchronized positions without blocking local use', () => {
  assert.match(continuitySource, /novelight-reading-sync\.js/);
  assert.match(continuitySource, /hydrateNovelProgress/);
  assert.match(continuitySource, /hydrateManyProgress/);
  assert.match(continuitySource, /keeping this device copy/);
  assert.match(homeSource, /novelight-reading-sync\.js/);
  assert.match(homeSource, /recentProgress/);
  assert.match(homeSource, /ログイン中の読書位置を端末間で同期しています/);
  assert.match(homeSource, /この端末の読書履歴から表示しています/);
});

test('reading position table is private by RLS with explicit Data API grants', () => {
  assert.match(migration, /create table public\.reader_reading_positions/);
  assert.match(migration, /alter table public\.reader_reading_positions enable row level security/);
  assert.match(
    migration,
    /revoke all on table public\.reader_reading_positions from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.reader_reading_positions to authenticated/
  );
  assert.match(
    migration,
    /to authenticated\s+using \(\(select auth\.uid\(\)\) is not null and user_id = \(select auth\.uid\(\)\)\)/
  );
  assert.match(migration, /for insert\s+to authenticated\s+with check/);
  assert.match(migration, /for update\s+to authenticated[\s\S]*with check/);
  assert.doesNotMatch(
    migration,
    /grant (?:select|insert|update|delete)[^;]*reader_reading_positions to anon/i
  );
});

test('database guard rejects stale device overwrites using revision and chronology', () => {
  assert.match(migration, /new\.revision is distinct from old\.revision/);
  assert.match(migration, /new\.last_read_at < old\.last_read_at/);
  assert.match(migration, /new\.revision := old\.revision \+ 1/);
  assert.match(migration, /before insert or update on public\.reader_reading_positions/);
  assert.match(migration, /e\.status = 'published'/);
  assert.match(migration, /n\.status = 'published'/);
  assert.doesNotMatch(migration, /valid_read_events/);
  assert.doesNotMatch(migration, /light_seed/i);
  assert.doesNotMatch(migration, /work_rank/i);
});
