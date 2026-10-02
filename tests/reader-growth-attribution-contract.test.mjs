import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20261002113000_reader_growth_attribution.sql',
  import.meta.url
);

async function read(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('reader share attribution tables are private and protected by RLS', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(
    sql,
    /alter table public\.scout_share_links enable row level security/i
  );
  assert.match(
    sql,
    /alter table public\.scout_share_claims enable row level security/i
  );
  assert.match(
    sql,
    /revoke all on table public\.scout_share_links from public, anon, authenticated, service_role/i
  );
  assert.match(
    sql,
    /revoke all on table public\.scout_share_claims from public, anon, authenticated, service_role/i
  );
});

test('discovery attribution uses the authoritative hardened valid-read signals', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /join public\.valid_read_events/i);
  assert.match(sql, /v\.foreground_signal/i);
  assert.match(sql, /v\.progress_signal or v\.interaction_signal/i);
  assert.match(sql, /v\.qualified_at >= c\.claimed_at/i);
});

test('share attribution never writes SCOUT scoring ledgers', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.doesNotMatch(
    sql,
    /insert\s+into\s+public\.scout_(?:event|xp|point)_ledger/i
  );
  assert.match(sql, /'scoringImpact', false/i);
});

test('a recipient and work can only be attributed once', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /unique \(recipient_user_id, novel_id\)/i);
  assert.match(sql, /on conflict \(recipient_user_id, novel_id\) do nothing/i);
});

test('public sharing gracefully layers SCOUT attribution on top of existing UTM tracking', async () => {
  const source = await read('../novelight-public-share.js');

  assert.match(source, /utm_campaign/);
  assert.match(source, /novelight_work_share/);
  assert.match(source, /scout_share/);
  assert.match(source, /novelight_scout_share_link/);
  assert.match(source, /novelight_claim_scout_share/);
});

test('SCOUT share results are displayed as private, non-scoring information', async () => {
  const source = await read('../novelight-scout-share-attribution.js');

  assert.match(source, /あなたと運営だけが確認できます/);
  assert.match(
    source,
    /Scout XP・Scout Point・Scout Rank・作品Rankには影響しません/
  );
  assert.doesNotMatch(source, /recipient_user_id/);
});

test('admin analytics exposes source retention and valid-read share conversion', async () => {
  const page = await read('../admin-analytics.html');
  const api = await read('../api/admin-analytics.js');

  assert.match(page, /7日継続/);
  assert.match(page, /30日継続/);
  assert.match(page, /共有からの読者発見/);
  assert.match(api, /novelight_admin_acquisition_retention/);
  assert.match(api, /novelight_admin_scout_share_snapshot/);
});
