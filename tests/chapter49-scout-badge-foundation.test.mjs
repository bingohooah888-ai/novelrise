import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260921022608_scout_badge_foundation.sql';
const precheckPath =
  'supabase/checks/20260921022608_scout_badge_foundation_precheck.sql';
const postcheckPath =
  'supabase/checks/20260921022608_scout_badge_foundation_postcheck.sql';
const rollbackPath =
  'supabase/rollback/20260921022608_scout_badge_foundation_rollback.sql';

function has(text, token) {
  assert.equal(text.includes(token), true, `missing token: ${token}`);
}

test('SCOUT badge foundation is data-driven and private', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const table of [
    'scout_badge_runtime_config',
    'scout_badge_definitions',
    'user_scout_badges',
    'scout_badge_metric_events',
    'scout_badge_metric_state',
    'scout_episode_badge_state'
  ]) {
    has(sql, `create table public.${table}`);
    has(sql, `alter table public.${table} enable row level security`);
  }
  has(sql, "badge_category in ('reader', 'author', 'limited')");
  has(sql, "difficulty in ('easy', 'normal', 'hard', 'special')");
  has(sql, "retroactive_policy text not null default 'none'");
});

test('exact Author Badge 40 are present and never award Scout Point', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (let i = 1; i <= 40; i += 1) {
    has(sql, `author_badge_${String(i).padStart(3, '0')}`);
  }
  has(sql, "'author','easy','初作品公開'");
  has(sql, "'author','hard','5作品がSEED後 +2 Rank'");
  assert.equal((sql.match(/'author_badge_\d{3}'/gu) ?? []).length, 40);
  assert.doesNotMatch(sql, /'author_badge_\d{3}'[^\n]*,[1-9]\d*,false/gu);
});

test('Limited badges reuse qualification ledgers instead of duplicating eligibility', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "'limited_founding_author'");
  has(sql, "'limited_beta_participant'");
  has(sql, 'from public.founding_authors f');
  has(sql, 'from public.beta_participants b');
  has(sql, 'coalesce(f.qualified_at, now())');
  has(sql, 'coalesce(b.qualified_at, now())');
  has(sql, "Founding Author #' || lpad");
});

test('Reader Badge definitions are intentionally not fabricated', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(
    sql,
    'Reader Badge 100 individual conditions are intentionally NOT invented here'
  );
  assert.doesNotMatch(sql, /'reader_badge_[^']*','reader'/u);
});

test('Author badge metrics are future-only and deduplicated', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'dedupe_key text not null unique');
  has(sql, "'author_work_published:' || new.id::text");
  has(
    sql,
    "'author_favorite:' || v_author::text || ':' || new.novel_id::text || ':' || new.user_id::text"
  );
  has(
    sql,
    "'author_unique_reader:' || new.author_id_snapshot::text || ':' || new.reader_id::text"
  );
  has(sql, "'author_seed_growth_plus2:' || v_author::text || ':' || v_novel");
  has(sql, 'Existing published episodes are baseline-only');
  assert.doesNotMatch(
    sql,
    /insert into public\.scout_badge_metric_events[\s\S]{0,500}select/iu
  );
});

test('owner badge API exposes progress and public visibility only through RPC', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'create or replace function public.novelight_scout_badges()');
  has(sql, 'progress_value bigint');
  has(sql, 'progress_percent numeric');
  has(
    sql,
    'create or replace function public.novelight_set_scout_badge_visibility'
  );
  has(sql, 'grant execute on function public.novelight_scout_badges()');
  has(sql, 'to authenticated;');
  assert.doesNotMatch(
    sql,
    /grant\s+select\s+on\s+table\s+public\.user_scout_badges/iu
  );
});

test('public SCOUT record excludes private XP and Point ledger details', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const start = sql.indexOf(
    'create or replace function public.novelight_public_scout_record'
  );
  assert.ok(start >= 0);
  const body = sql.slice(start);
  has(body, "'level'");
  has(body, "'rank_tier'");
  has(body, "'discovery_success_count'");
  has(body, "'badges'");
  has(body, "'representative_discoveries'");
  assert.doesNotMatch(body, /point_balance|pending_points|point_history/iu);
  has(
    body,
    'grant execute on function public.novelight_public_scout_record(uuid)'
  );
  has(body, 'to anon, authenticated;');
});

test('precheck/postcheck protect counts, grants and no-reader-source boundary', async () => {
  const [precheck, postcheck] = await Promise.all([
    readFile(precheckPath, 'utf8'),
    readFile(postcheckPath, 'utf8')
  ]);
  has(precheck, 'SCOUT RECORD beta core is missing');
  has(precheck, 'SCOUT badge foundation already exists');
  has(postcheck, 'v_author <> 40');
  has(postcheck, 'v_limited <> 2');
  has(postcheck, 'v_reader <> 0');
  has(postcheck, 'Author Badge must not award Scout Point');
  has(postcheck, 'Badge retroactive policy must default to none');
  has(postcheck, 'SCOUT badge raw tables must remain RPC-only');
});

test('rollback disables mutation paths and preserves earned audit history', async () => {
  const sql = await readFile(rollbackPath, 'utf8');
  has(sql, 'drop trigger if exists scout_badge_track_author_seed_growth');
  has(sql, 'drop trigger if exists scout_badge_track_author_work');
  has(sql, 'if not v_has_user_badges and not v_has_metric_events then');
  has(sql, 'revoke all on table public.user_scout_badges');
  assert.doesNotMatch(sql, /delete\s+from|truncate\s+/iu);
});
