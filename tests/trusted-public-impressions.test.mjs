import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL(
    'supabase/migrations/20260913112358_trusted_public_impression_receipts.sql',
    root
  ),
  'utf8'
);
const discovery = await readFile(
  new URL('novelight-discovery-list.js', root),
  'utf8'
);
const home = await readFile(new URL('index.html', root), 'utf8');

test('anonymous author-facing impressions still require short-lived server-issued receipts', () => {
  assert.match(migration, /viewer_key text/u);
  assert.match(
    migration,
    /viewer_id is null[\s\S]*viewer_key like 'visitor:%'/u
  );
  assert.match(migration, /expires_at > now\(\)/u);
  assert.match(migration, /consumed_at is null/u);
  assert.match(migration, /set consumed_at = now\(\)/u);
  assert.match(migration, /record_trusted_allocation_receipts_v2_impl/u);
  assert.match(migration, /p_visitor_token text default null/u);
  assert.match(migration, /r\.viewer_key = v_expected_viewer_key/u);
  assert.match(
    migration,
    /grant execute on function public\.record_trusted_allocation_receipts_v2\(uuid\[\], text\) to anon, authenticated/u
  );
  assert.match(
    migration,
    /revoke all on function public\.record_novel_impressions\(text, text\[\], text\) from public, anon, authenticated/u
  );
  assert.match(
    migration,
    /revoke all on function public\.record_novel_impressions_v2\(text, text\[\], text\) from public, anon, authenticated/u
  );
});

test('public shelf receipt issuer validates the claimed surface against its authoritative feed', () => {
  assert.match(
    migration,
    /novelight_issue_visible_allocation_receipts_v2_impl/u
  );
  assert.match(migration, /novelight_neutral_search\(/u);
  assert.match(migration, /novelight_light_seed_feed\(/u);
  assert.match(migration, /novelight_beta_rank_discovery_feed\(/u);
  assert.match(migration, /not \(requested\.novel_id = any\(v_eligible\)\)/u);
  assert.match(
    migration,
    /One or more works are not eligible for the claimed rendered surface/u
  );
  assert.match(migration, /home_new/u);
  assert.match(migration, /home_seed/u);
  assert.match(migration, /home_rank_unseen/u);
  assert.match(migration, /home_rank_gathering/u);
  assert.match(migration, /search_new/u);
  assert.match(migration, /search_seed/u);
});

test('new privileged helpers stay in the private schema behind invoker-only public wrappers', () => {
  assert.match(migration, /create schema if not exists private/u);
  assert.match(
    migration,
    /private\.novelight_trusted_discovery_feed_v2_impl/u
  );
  assert.match(migration, /security definer[\s\S]*set search_path = ''/u);
  assert.match(migration, /public\.novelight_trusted_discovery_feed_v2/u);
  assert.match(migration, /security invoker/u);
  assert.doesNotMatch(
    migration,
    /public\.novelight_trusted_discovery_feed_v2[\s\S]{0,500}security definer/u
  );
});

test('dedicated discovery pages consume author-facing receipts only after cards are appended', () => {
  const newBlock =
    discovery.match(/async function loadNew\(\) \{([\s\S]*?)\n  \}/u)?.[1] || '';
  const seedBlock =
    discovery.match(/async function loadSeed\(\) \{([\s\S]*?)\n  \}/u)?.[1] || '';
  assert.ok(
    newBlock.indexOf('appendRows(rows)') <
      newBlock.indexOf("recordVisible('search_new'")
  );
  assert.ok(
    seedBlock.indexOf('appendRows(page)') <
      seedBlock.indexOf("recordVisible('search_seed'")
  );
  assert.match(discovery, /novelight_issue_visible_allocation_receipts_v2/u);
  assert.match(discovery, /record_trusted_allocation_receipts_v2/u);
  assert.match(discovery, /recordNeutralFallback/u);
});

test('home records only viewport-visible rows after DOM rendering', () => {
  assert.match(
    home,
    /grid\.innerHTML=visible\.length\?visible\.map\(card\)\.join\(''\)/u
  );
  assert.match(
    home,
    /if\(visible\.length\)void issueAndRecord\('home_new',visible\)/u
  );
  assert.match(
    home,
    /if\(seeded\.length\)void issueAndRecord\('home_seed',seeded\)/u
  );
  assert.match(home, /home_rank_unseen/u);
  assert.match(home, /home_rank_gathering/u);
  assert.match(home, /p_rotation_key:rotationKey/u);
});
