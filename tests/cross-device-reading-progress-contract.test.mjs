import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const continuityUrl = new URL('../novelight-reading-continuity.js', import.meta.url);
const homeResumeUrl = new URL('../novelight-home-resume.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260917030000_reader_reading_progress_sync.sql', import.meta.url);
const precheckUrl = new URL('../supabase/checks/20260917030000_reader_reading_progress_sync_precheck.sql', import.meta.url);
const postcheckUrl = new URL('../supabase/checks/20260917030000_reader_reading_progress_sync_postcheck.sql', import.meta.url);
const rollbackUrl = new URL('../supabase/rollback/20260917030000_reader_reading_progress_sync_rollback.sql', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('reader progress migration keeps synchronized history private and user-owned', async () => {
  const migration = await text(migrationUrl);

  assert.match(migration, /create table public\.reader_reading_progress/);
  assert.match(migration, /primary key \(user_id, novel_id\)/);
  assert.match(migration, /alter table public\.reader_reading_progress enable row level security/);
  assert.match(migration, /grant select, insert, update on table public\.reader_reading_progress to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*reader_reading_progress[^;]*authenticated/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(migration, /grant[^;]*reader_reading_progress[^;]*anon/i);
});

test('database guard derives published episode order and refuses progress rewind', async () => {
  const migration = await text(migrationUrl);

  assert.match(migration, /where e\.id = new\.episode_id/);
  assert.match(migration, /e\.novel_id = new\.novel_id/);
  assert.match(migration, /e\.status = 'published'/);
  assert.match(migration, /new\.episode_number := v_episode_number/);
  assert.match(migration, /if new\.episode_number < old\.episode_number then/);
  assert.match(migration, /new\.episode_id := old\.episode_id/);
  assert.match(migration, /new\.progress_ratio := old\.progress_ratio/);
  assert.match(migration, /greatest\(old\.progress_ratio, new\.progress_ratio\)/);
  assert.match(migration, /v_incoming_read_at > v_now \+ interval '5 minutes'/);
});

test('episode, novel, and favorites continuity hydrates authenticated progress but preserves local fallback', async () => {
  const continuity = await text(continuityUrl);

  assert.match(continuity, /const REMOTE_TABLE = 'reader_reading_progress'/);
  assert.match(continuity, /clientInstance\.auth\.getSession\(\)/);
  assert.match(continuity, /hydrateRemoteProgress\(clientInstance, \[row\.novel_id\]\)/);
  assert.match(continuity, /hydrateRemoteProgress\(clientInstance, \[novelId\]\)/);
  assert.match(continuity, /hydrateRemoteProgress\(clientInstance, novelIds\)/);
  assert.match(continuity, /\.upsert\(/);
  assert.match(continuity, /onConflict: 'user_id,novel_id'/);
  assert.match(continuity, /REMOTE_SAVE_DELAY_MS = 2500/);
  assert.match(continuity, /reading progress hydration failed; using this device/);
  assert.match(continuity, /reading progress sync failed; kept on this device/);
});

test('client merge is monotonic by episode and same-episode progress', async () => {
  const continuity = await text(continuityUrl);

  assert.match(continuity, /if \(incomingNumber > currentNumber\) return/);
  assert.match(continuity, /if \(incomingNumber < currentNumber\) return/);
  assert.match(continuity, /Math\.max\(clamp\(current\.progressRatio\), clamp\(incoming\.progressRatio\)\)/);
  assert.match(continuity, /syncUserId/);
});

test('home continue reading hydrates recent server progress only for authenticated users', async () => {
  const home = await text(homeResumeUrl);

  assert.match(home, /clientInstance\.auth\.getSession\(\)/);
  assert.match(home, /\.from\(REMOTE_TABLE\)/);
  assert.match(home, /\.order\('last_read_at', \{ ascending: false \}\)/);
  assert.match(home, /\.limit\(CANDIDATE_LIMIT\)/);
  assert.match(home, /ログイン中は読書履歴を端末間で同期します。/);
  assert.match(home, /この端末の読書履歴から表示しています。/);
  assert.doesNotMatch(home, /\.upsert\(/);
});

test('migration includes guarded precheck, postcheck, and destructive rollback artifact', async () => {
  const [precheck, postcheck, rollback] = await Promise.all([
    text(precheckUrl),
    text(postcheckUrl),
    text(rollbackUrl)
  ]);

  assert.match(precheck, /Reader progress sync objects already exist/);
  assert.match(postcheck, /RLS must be enabled on reader_reading_progress/);
  assert.match(postcheck, /Authenticated reader progress privileges are incorrect/);
  assert.match(postcheck, /Reader progress guard trigger is missing/);
  assert.match(rollback, /drop table if exists public\.reader_reading_progress/);
});
