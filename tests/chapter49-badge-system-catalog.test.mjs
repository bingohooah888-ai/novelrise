import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260921063000_badge_system_catalog.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260921063000_badge_system_catalog_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260921063000_badge_system_catalog_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260921063000_badge_system_catalog_rollback.sql',
  'utf8'
);

const readerIds = [
  'reader_read_001',
  'reader_read_005',
  'reader_read_010',
  'reader_read_025',
  "reader_rating_001",
  "reader_rating_005",
  "reader_rating_010",
  "reader_comment_001",
  "reader_comment_005",
  "reader_comment_010",
  'reader_seed_001',
  'reader_seed_003',
  'reader_seed_005',
  'reader_seed_010',
  "reader_bronze_seed_001",
  'reader_silver_seed_001',
  'reader_gold_seed_001',
  'reader_discovery_plus2_001',
  'reader_discovery_plus2_002',
  'reader_discovery_plus2_003',
  "reader_new_author_005",
  "reader_new_author_010",
  "reader_genre_003",
  "reader_genre_005",
  "reader_new_work_005",
  "reader_low_rank_005",
  'reader_level_005',
  'reader_level_010',
  'reader_level_020',
  'reader_active_days_007',
  'reader_read_050',
  'reader_read_100',
  'reader_read_200',
  'reader_read_300',
  "reader_rating_025",
  "reader_rating_050",
  "reader_rating_100",
  "reader_comment_025",
  "reader_comment_050",
  "reader_comment_100",
  'reader_seed_025',
  'reader_seed_050',
  'reader_seed_100',
  'reader_gold_seed_005',
  'reader_silver_seed_010',
  "reader_bronze_seed_015",
  'reader_discovery_plus2_005',
  'reader_discovery_plus2_010',
  'reader_discovery_plus2_020',
  'reader_discovery_plus3_001',
  'reader_discovery_plus3_005',
  'reader_discovery_plus3_010',
  'reader_discovery_plus4_001',
  'reader_discovery_plus4_002',
  'reader_discovery_plus4_005',
  "reader_nova_001",
  "reader_nova_003",
  "reader_nova_005",
  "reader_new_author_025",
  "reader_new_author_050",
  "reader_new_author_100",
  "reader_low_rank_025",
  "reader_low_rank_050",
  "reader_low_rank_100",
  "reader_new_work_025",
  "reader_new_work_050",
  "reader_new_work_100",
  "reader_genre_008",
  "reader_genre_010",
  "reader_long_read_005",
  "reader_long_read_010",
  'reader_short_read_010',
  'reader_short_read_025',
  'reader_completed_read_005',
  'reader_completed_read_010',
  'reader_active_days_030',
  'reader_active_days_090',
  'reader_level_030',
  "reader_point_100",
  "reader_point_500",
  'reader_read_500',
  'reader_read_1000',
  "reader_new_author_250",
  "reader_low_rank_250",
  "reader_low_rank_500",
  'reader_discovery_plus2_050',
  'reader_discovery_plus2_100',
  'reader_discovery_plus3_025',
  'reader_discovery_plus3_050',
  'reader_discovery_plus4_010',
  'reader_discovery_plus4_020',
  'reader_discovery_plus5_001',
  'reader_discovery_plus5_003',
  'reader_discovery_plus5_010',
  "reader_nova_010",
  "reader_nova_025",
  'reader_gold_plus5_001',
  'reader_silver_plus5_001',
  "reader_bronze_plus5_001",
  "reader_master_scout"
];
const authorIds = [
  "author_novel_001",
  'author_episode_001',
  'author_reader_001',
  'author_favorite_001',
  "author_comment_001",
  'author_episode_010',
  'author_episode_025',
  'author_episode_050',
  'author_episode_100',
  'author_episode_250',
  'author_chars_010k',
  'author_chars_050k',
  'author_chars_100k',
  'author_chars_250k',
  'author_chars_500k',
  'author_completed_001',
  'author_completed_003',
  'author_completed_005',
  "author_novel_002",
  "author_novel_005",
  "author_novel_010",
  "author_unique_reader_010",
  "author_unique_reader_050",
  "author_unique_reader_100",
  "author_unique_reader_500",
  'author_favorite_010',
  'author_favorite_050',
  'author_favorite_100',
  "author_comment_010",
  "author_comment_050",
  'author_seed_received_001',
  'author_seed_received_010',
  'author_seed_received_050',
  'author_discovered_plus2_001',
  'author_discovered_plus3_001',
  'author_chars_1m',
  'author_completed_010',
  "author_unique_reader_1000",
  'author_favorite_500',
  "author_discovered_plus2_005"
];

function has(text, value) {
  assert.equal(text.includes(value), true, `missing token: ${value}`);
}

test(
  'Badge System registers exactly the canonical Reader 100 and Author 40 ids',
  () => {
  assert.equal(readerIds.length, 100);
  assert.equal(authorIds.length, 40);

  for (const id of readerIds) has(migration, `'${id}'`);
  for (const id of authorIds) has(migration, `'${id}'`);

  assert.equal(new Set(readerIds).size, 100);
  assert.equal(new Set(authorIds).size, 40);
  has(postcheck, 'v_reader <> 100');
  has(postcheck, 'v_reader_easy <> 30');
  has(postcheck, 'v_reader_normal <> 50');
  has(postcheck, 'v_reader_hard <> 20');
  has(postcheck, 'v_author <> 40');
  has(postcheck, 'v_author_easy <> 5');
  has(postcheck, 'v_author_normal <> 30');
    has(postcheck, 'v_author_hard <> 5');
  }
);

test('Reader reward tiers and Point-loop exceptions are encoded as data', () => {
  has(migration, "'reader_point_100','reader','normal'");
  has(migration, "'reader_point_500','reader','normal'");
  has(postcheck, 'Reader Easy Badge reward must be 1 Point');
  has(postcheck, 'Normal standard Reader Badge reward must be 5 Point');
  has(postcheck, 'Normal important Reader Badge reward must be 10 Point');
  has(postcheck, 'Point-threshold Reader Badges must award 0 Point');
  has(postcheck, 'Reader Hard Badge reward must be 25 Point');
  has(postcheck, 'Author Badge must never award Scout Point');
  has(migration, "'reason_type', 'badge_reward'");
  has(migration, "'reason_id', p_badge_id");
  has(migration, "'badge:' || p_user_id::text || ':' || p_badge_id");
});

test(
  'Master Scout is a generic composite-all definition with four visible component progresses',
  () => {
  has(migration, "'reader_master_scout'");
  has(migration, "'composite_all'");
  has(migration, '"metric_key":"discovery_plus5_count"');
  has(migration, '"metric_key":"nova_prediction_count"');
  has(migration, '"metric_key":"new_author_read_count"');
  has(migration, '"metric_key":"genre_count"');
  has(migration, "pg_catalog.jsonb_array_elements");
  has(migration, "'composite_progress'");
  assert.doesNotMatch(migration, /if\s+p_badge_id\s*=\s*'reader_/iu);
});

test('Reader metrics use authoritative sources and configurable thresholds', () => {
  for (const token of [
    'public.valid_read_events',
    'public.novel_star_ratings',
    'public.novel_comments',
    'public.light_seeds',
    'public.seed_discovery_state',
    'public.novel_rank_events',
    'public.scout_xp_ledger',
    'public.scout_point_ledger'
  ]) {
    has(migration, token);
  }

  for (const key of [
    '"new_author_days":30',
    '"new_work_days":7',
    '"low_rank_threshold":2',
    '"long_chars":100000',
    '"long_valid_episodes":5',
    '"short_chars":20000',
    '"completed_read_ratio":0.80'
  ]) {
    has(migration, key);
  }

  has(migration, "count(distinct n.genre)");
  has(migration, "v.qualified_at < a.first_published_at");
  has(migration, "v.qualified_at < n.first_published_at");
  has(migration, "re.occurred_at <= v.qualified_at");
  has(migration, "r.read_final_episode");
  has(migration, "r.valid_read_episodes::numeric / r.published_episodes::numeric >= v_completed_ratio");
});

test(
  'Author metrics are rebuilt from current published authoritative state',
  () => {
  has(migration, 'create or replace function public.novelight_author_badge_metrics');
  has(migration, "n.status = 'published'");
  has(migration, "e.status = 'published'");
  has(migration, 'count(distinct v.reader_id)');
  has(migration, 'c.deleted_at is null');
  has(migration, 'c.author_hidden_at is null');
    has(migration, 'count(distinct d.novel_id_snapshot)');
  }
);

test(
  'provisional Author IDs migrate once to canonical IDs without double counting',
  () => {
  has(migration, "badge_id ~ '^author_badge_[0-9]{3}$'");
  has(migration, "'migrated_from_badge_id'");
  has(migration, 'delete from public.user_scout_badges b');
  has(postcheck, 'Legacy provisional Author Badge IDs must be disabled');
    has(
      postcheck,
      'Legacy per-user Author Badge aliases must be migrated to canonical IDs'
    );
  }
);

test(
  'historical progress baseline is separated from retroactive Reader Point rewards',
  () => {
  has(migration, 'public.novelight_refresh_scout_badges_for_user(v_user.id, false)');
  has(migration, 'p_award_reader_points boolean');
  has(migration, "and coalesce(p_award_points, false)");
  has(migration, "retroactive_policy = 'none'");
  has(precheck, "retroactive_policy = 'none'");
    has(postcheck, "retroactive_policy='none'");
  }
);

test(
  'badge engine is idempotent and event-driven without 140 bespoke branches',
  () => {
  has(migration, 'public.novelight_evaluate_scout_badge');
  has(migration, 'public.novelight_apply_scout_badge_evaluation');
  has(migration, 'public.novelight_refresh_scout_badges_for_user');
  has(migration, 'scout_event_refresh_reader_badges');
  has(migration, 'scout_discovery_refresh_reader_badges');
  has(migration, 'scout_xp_refresh_reader_badges');
  has(migration, 'scout_point_refresh_reader_badges');
  has(migration, 'scout_comment_refresh_reader_badges');
  has(migration, 'scout_metric_state_refresh_badges');
  has(migration, 'on conflict (event_key) do nothing');
  assert.doesNotMatch(migration, /case\s+p_badge_id/iu);
});

test(
  'Limited badges remain separate and raw badge tables remain private',
  () => {
  has(precheck, 'Expected Founding Author and beta Participant Limited badges');
  has(postcheck, 'v_limited <> 2');
  has(postcheck, 'Badge raw tables must remain RPC-only');
  assert.doesNotMatch(migration, /update\s+public\.scout_badge_definitions[\s\S]{0,220}badge_category\s*=\s*'limited'[\s\S]{0,120}badge_category\s*=\s*'author'/iu);
});

test(
  'rollback restores the deployed Author ID contract and preserves earned Reader history',
  () => {
  has(rollback, 'Restore per-user Author progress');
  has(rollback, "'rolled_back_from_badge_id'");
  has(rollback, "badge_id like 'reader_%'");
  has(rollback, "status in ('earned','revoked')");
  has(rollback, "rule_version='beta-2026-09-21-rollback-preserved'");
  assert.doesNotMatch(rollback, /truncate\s+/iu);
});