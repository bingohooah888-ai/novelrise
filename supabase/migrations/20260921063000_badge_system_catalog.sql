-- NOVELIGHT Badge System beta catalog.
-- Canonical Reader Badge 100 / Author Badge 40 implementation supplied by OWNER.
-- This is a forward-only extension of the already-deployed Chapter 49 badge foundation.
--
-- Safety:
-- - existing badge/source ledgers remain the evidence Source of Truth
-- - Reader progress/earned state is baseline-rebuilt without retroactive Scout Point
-- - future badge rewards are idempotent through scout_point_ledger.event_key
-- - Author legacy IDs are preserved disabled after migration to canonical IDs
-- - no raw badge table is exposed to browser roles

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921063000'));

do $$
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.valid_read_events') is null
     or to_regclass('public.novel_star_ratings') is null
     or to_regclass('public.novel_comments') is null
     or to_regclass('public.light_seeds') is null
     or to_regclass('public.seed_discovery_state') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novel_rank_events') is null then
    raise exception 'Badge System requires the deployed SCOUT, rating, comment, SEED and badge foundations';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions d
     where d.badge_category = 'reader'
       and d.enabled
  ) then
    raise exception 'Enabled Reader Badge definitions already exist and require reconciliation';
  end if;
end
$$;

alter table public.scout_badge_runtime_config
  add column if not exists badge_settings jsonb not null default
    '{"new_author_days":30,"new_work_days":7,"low_rank_threshold":2,"long_chars":100000,"long_valid_episodes":5,"short_chars":20000,"completed_read_ratio":0.80}'::jsonb,
  add column if not exists reader_badges_activated_at timestamptz;

alter table public.scout_badge_definitions
  add column if not exists metric_key text,
  add column if not exists condition_config jsonb not null default '{}'::jsonb;

update public.scout_badge_runtime_config
   set badge_settings =
       '{"new_author_days":30,"new_work_days":7,"low_rank_threshold":2,"long_chars":100000,"long_valid_episodes":5,"short_chars":20000,"completed_read_ratio":0.80}'::jsonb
       || coalesce(badge_settings, '{}'::jsonb),
       rule_version = 'badge-system-beta-2026-09-21',
       reader_badges_activated_at = coalesce(reader_badges_activated_at, now()),
       updated_at = now()
 where id = 1;

-- Preserve the original metric key before normalizing the definition contract.
update public.scout_badge_definitions
   set metric_key = coalesce(metric_key, condition_type),
       condition_type = case
         when badge_category = 'limited' then 'boolean'
         else 'threshold'
       end,
       condition_config = coalesce(condition_config, '{}'::jsonb),
       updated_at = now()
 where badge_category in ('author','limited')
   and (metric_key is null or condition_type not in ('counter','boolean','threshold','composite_all'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'scout_badge_condition_type_supported'
       and conrelid = 'public.scout_badge_definitions'::regclass
  ) then
    alter table public.scout_badge_definitions
      add constraint scout_badge_condition_type_supported
      check (condition_type in ('counter','boolean','threshold','composite_all'));
  end if;
end
$$;

-- Move the deployed provisional Author IDs out of canonical sort slots. They are
-- retained as disabled audit aliases until their user rows are safely migrated.
update public.scout_badge_definitions
   set sort_order = 1000 + coalesce((metadata->>'spec_no')::integer, sort_order),
       enabled = false,
       updated_at = now()
 where badge_category = 'author'
   and badge_id ~ '^author_badge_[0-9]{3}$';

insert into public.scout_badge_definitions (
  badge_id, badge_category, difficulty, display_name, description,
  metric_key, condition_type, target_value, condition_config, point_reward,
  is_limited, is_hidden, enabled, sort_order, metadata
) values
  ('author_novel_001','author','easy','初作品公開','初作品を公開','author_work_published','threshold',1,'{}'::jsonb,0,false,false,true,1,pg_catalog.jsonb_build_object('spec_no',1,'spec_version','badge-system-beta-2026-09-21')),
  ('author_episode_001','author','easy','初エピソード公開','初エピソード公開','author_episode_published','threshold',1,'{}'::jsonb,0,false,false,true,2,pg_catalog.jsonb_build_object('spec_no',2,'spec_version','badge-system-beta-2026-09-21')),
  ('author_reader_001','author','easy','初ユニーク読者','初ユニーク読者獲得','author_unique_readers','threshold',1,'{}'::jsonb,0,false,false,true,3,pg_catalog.jsonb_build_object('spec_no',3,'spec_version','badge-system-beta-2026-09-21')),
  ('author_favorite_001','author','easy','初お気に入り','初お気に入り獲得','author_favorites_received','threshold',1,'{}'::jsonb,0,false,false,true,4,pg_catalog.jsonb_build_object('spec_no',4,'spec_version','badge-system-beta-2026-09-21')),
  ('author_comment_001','author','easy','初有効コメント','初有効コメント獲得','author_comments_received','threshold',1,'{}'::jsonb,0,false,false,true,5,pg_catalog.jsonb_build_object('spec_no',5,'spec_version','badge-system-beta-2026-09-21')),
  ('author_episode_010','author','normal','累計10話公開','累計10話公開','author_episode_published','threshold',10,'{}'::jsonb,0,false,false,true,6,pg_catalog.jsonb_build_object('spec_no',6,'spec_version','badge-system-beta-2026-09-21')),
  ('author_episode_025','author','normal','累計25話公開','累計25話公開','author_episode_published','threshold',25,'{}'::jsonb,0,false,false,true,7,pg_catalog.jsonb_build_object('spec_no',7,'spec_version','badge-system-beta-2026-09-21')),
  ('author_episode_050','author','normal','累計50話公開','累計50話公開','author_episode_published','threshold',50,'{}'::jsonb,0,false,false,true,8,pg_catalog.jsonb_build_object('spec_no',8,'spec_version','badge-system-beta-2026-09-21')),
  ('author_episode_100','author','normal','累計100話公開','累計100話公開','author_episode_published','threshold',100,'{}'::jsonb,0,false,false,true,9,pg_catalog.jsonb_build_object('spec_no',9,'spec_version','badge-system-beta-2026-09-21')),
  ('author_episode_250','author','normal','累計250話公開','累計250話公開','author_episode_published','threshold',250,'{}'::jsonb,0,false,false,true,10,pg_catalog.jsonb_build_object('spec_no',10,'spec_version','badge-system-beta-2026-09-21')),
  ('author_chars_010k','author','normal','累計10,000文字','累計公開本文10,000文字','author_words_published','threshold',10000,'{}'::jsonb,0,false,false,true,11,pg_catalog.jsonb_build_object('spec_no',11,'spec_version','badge-system-beta-2026-09-21')),
  ('author_chars_050k','author','normal','累計50,000文字','累計公開本文50,000文字','author_words_published','threshold',50000,'{}'::jsonb,0,false,false,true,12,pg_catalog.jsonb_build_object('spec_no',12,'spec_version','badge-system-beta-2026-09-21')),
  ('author_chars_100k','author','normal','累計100,000文字','累計公開本文100,000文字','author_words_published','threshold',100000,'{}'::jsonb,0,false,false,true,13,pg_catalog.jsonb_build_object('spec_no',13,'spec_version','badge-system-beta-2026-09-21')),
  ('author_chars_250k','author','normal','累計250,000文字','累計公開本文250,000文字','author_words_published','threshold',250000,'{}'::jsonb,0,false,false,true,14,pg_catalog.jsonb_build_object('spec_no',14,'spec_version','badge-system-beta-2026-09-21')),
  ('author_chars_500k','author','normal','累計500,000文字','累計公開本文500,000文字','author_words_published','threshold',500000,'{}'::jsonb,0,false,false,true,15,pg_catalog.jsonb_build_object('spec_no',15,'spec_version','badge-system-beta-2026-09-21')),
  ('author_completed_001','author','normal','初作品完結','初作品完結','author_works_completed','threshold',1,'{}'::jsonb,0,false,false,true,16,pg_catalog.jsonb_build_object('spec_no',16,'spec_version','badge-system-beta-2026-09-21')),
  ('author_completed_003','author','normal','3作品完結','3作品完結','author_works_completed','threshold',3,'{}'::jsonb,0,false,false,true,17,pg_catalog.jsonb_build_object('spec_no',17,'spec_version','badge-system-beta-2026-09-21')),
  ('author_completed_005','author','normal','5作品完結','5作品完結','author_works_completed','threshold',5,'{}'::jsonb,0,false,false,true,18,pg_catalog.jsonb_build_object('spec_no',18,'spec_version','badge-system-beta-2026-09-21')),
  ('author_novel_002','author','normal','2作品公開','2作品公開','author_work_published','threshold',2,'{}'::jsonb,0,false,false,true,19,pg_catalog.jsonb_build_object('spec_no',19,'spec_version','badge-system-beta-2026-09-21')),
  ('author_novel_005','author','normal','5作品公開','5作品公開','author_work_published','threshold',5,'{}'::jsonb,0,false,false,true,20,pg_catalog.jsonb_build_object('spec_no',20,'spec_version','badge-system-beta-2026-09-21')),
  ('author_novel_010','author','normal','10作品公開','10作品公開','author_work_published','threshold',10,'{}'::jsonb,0,false,false,true,21,pg_catalog.jsonb_build_object('spec_no',21,'spec_version','badge-system-beta-2026-09-21')),
  ('author_unique_reader_010','author','normal','ユニーク読者10人','累計ユニーク読者10人','author_unique_readers','threshold',10,'{}'::jsonb,0,false,false,true,22,pg_catalog.jsonb_build_object('spec_no',22,'spec_version','badge-system-beta-2026-09-21')),
  ('author_unique_reader_050','author','normal','ユニーク読者50人','累計ユニーク読者50人','author_unique_readers','threshold',50,'{}'::jsonb,0,false,false,true,23,pg_catalog.jsonb_build_object('spec_no',23,'spec_version','badge-system-beta-2026-09-21')),
  ('author_unique_reader_100','author','normal','ユニーク読者100人','累計ユニーク読者100人','author_unique_readers','threshold',100,'{}'::jsonb,0,false,false,true,24,pg_catalog.jsonb_build_object('spec_no',24,'spec_version','badge-system-beta-2026-09-21')),
  ('author_unique_reader_500','author','normal','ユニーク読者500人','累計ユニーク読者500人','author_unique_readers','threshold',500,'{}'::jsonb,0,false,false,true,25,pg_catalog.jsonb_build_object('spec_no',25,'spec_version','badge-system-beta-2026-09-21')),
  ('author_favorite_010','author','normal','お気に入り10','累計お気に入り10','author_favorites_received','threshold',10,'{}'::jsonb,0,false,false,true,26,pg_catalog.jsonb_build_object('spec_no',26,'spec_version','badge-system-beta-2026-09-21')),
  ('author_favorite_050','author','normal','お気に入り50','累計お気に入り50','author_favorites_received','threshold',50,'{}'::jsonb,0,false,false,true,27,pg_catalog.jsonb_build_object('spec_no',27,'spec_version','badge-system-beta-2026-09-21')),
  ('author_favorite_100','author','normal','お気に入り100','累計お気に入り100','author_favorites_received','threshold',100,'{}'::jsonb,0,false,false,true,28,pg_catalog.jsonb_build_object('spec_no',28,'spec_version','badge-system-beta-2026-09-21')),
  ('author_comment_010','author','normal','有効コメント10件','累計有効コメント10件','author_comments_received','threshold',10,'{}'::jsonb,0,false,false,true,29,pg_catalog.jsonb_build_object('spec_no',29,'spec_version','badge-system-beta-2026-09-21')),
  ('author_comment_050','author','normal','有効コメント50件','累計有効コメント50件','author_comments_received','threshold',50,'{}'::jsonb,0,false,false,true,30,pg_catalog.jsonb_build_object('spec_no',30,'spec_version','badge-system-beta-2026-09-21')),
  ('author_seed_received_001','author','normal','初LIGHT SEED獲得','初LIGHT SEED獲得','author_seeds_received','threshold',1,'{}'::jsonb,0,false,false,true,31,pg_catalog.jsonb_build_object('spec_no',31,'spec_version','badge-system-beta-2026-09-21')),
  ('author_seed_received_010','author','normal','LIGHT SEED 10','累計LIGHT SEED 10','author_seeds_received','threshold',10,'{}'::jsonb,0,false,false,true,32,pg_catalog.jsonb_build_object('spec_no',32,'spec_version','badge-system-beta-2026-09-21')),
  ('author_seed_received_050','author','normal','LIGHT SEED 50','累計LIGHT SEED 50','author_seeds_received','threshold',50,'{}'::jsonb,0,false,false,true,33,pg_catalog.jsonb_build_object('spec_no',33,'spec_version','badge-system-beta-2026-09-21')),
  ('author_discovered_plus2_001','author','normal','自作品 +2 Rank成長','自作品1作品がLIGHT SEED後+2 Rank以上成長','author_seed_growth_plus2_works','threshold',1,'{}'::jsonb,0,false,false,true,34,pg_catalog.jsonb_build_object('spec_no',34,'spec_version','badge-system-beta-2026-09-21')),
  ('author_discovered_plus3_001','author','normal','自作品 +3 Rank成長','自作品1作品がLIGHT SEED後+3 Rank以上成長','author_seed_growth_plus3_works','threshold',1,'{}'::jsonb,0,false,false,true,35,pg_catalog.jsonb_build_object('spec_no',35,'spec_version','badge-system-beta-2026-09-21')),
  ('author_chars_1m','author','hard','累計1,000,000文字','累計公開本文1,000,000文字','author_words_published','threshold',1000000,'{}'::jsonb,0,false,false,true,36,pg_catalog.jsonb_build_object('spec_no',36,'spec_version','badge-system-beta-2026-09-21')),
  ('author_completed_010','author','hard','10作品完結','10作品完結','author_works_completed','threshold',10,'{}'::jsonb,0,false,false,true,37,pg_catalog.jsonb_build_object('spec_no',37,'spec_version','badge-system-beta-2026-09-21')),
  ('author_unique_reader_1000','author','hard','ユニーク読者1,000人','累計ユニーク読者1,000人','author_unique_readers','threshold',1000,'{}'::jsonb,0,false,false,true,38,pg_catalog.jsonb_build_object('spec_no',38,'spec_version','badge-system-beta-2026-09-21')),
  ('author_favorite_500','author','hard','お気に入り500','累計お気に入り500','author_favorites_received','threshold',500,'{}'::jsonb,0,false,false,true,39,pg_catalog.jsonb_build_object('spec_no',39,'spec_version','badge-system-beta-2026-09-21')),
  ('author_discovered_plus2_005','author','hard','5作品が +2 Rank成長','自作品5作品がLIGHT SEED後+2 Rank以上成長','author_seed_growth_plus2_works','threshold',5,'{}'::jsonb,0,false,false,true,40,pg_catalog.jsonb_build_object('spec_no',40,'spec_version','badge-system-beta-2026-09-21'))
on conflict (badge_id) do update
  set badge_category = excluded.badge_category,
      difficulty = excluded.difficulty,
      display_name = excluded.display_name,
      description = excluded.description,
      metric_key = excluded.metric_key,
      condition_type = excluded.condition_type,
      target_value = excluded.target_value,
      condition_config = excluded.condition_config,
      point_reward = 0,
      is_limited = false,
      is_hidden = excluded.is_hidden,
      enabled = true,
      sort_order = excluded.sort_order,
      metadata = public.scout_badge_definitions.metadata || excluded.metadata,
      updated_at = now();

-- Carry any already-earned/progressed provisional Author Badge to the canonical ID.
with author_id_map(old_id, new_id, spec_no) as (
values
  ('author_badge_001','author_novel_001',1),
  ('author_badge_002','author_episode_001',2),
  ('author_badge_003','author_reader_001',3),
  ('author_badge_004','author_favorite_001',4),
  ('author_badge_005','author_comment_001',5),
  ('author_badge_006','author_episode_010',6),
  ('author_badge_007','author_episode_025',7),
  ('author_badge_008','author_episode_050',8),
  ('author_badge_009','author_episode_100',9),
  ('author_badge_010','author_episode_250',10),
  ('author_badge_011','author_chars_010k',11),
  ('author_badge_012','author_chars_050k',12),
  ('author_badge_013','author_chars_100k',13),
  ('author_badge_014','author_chars_250k',14),
  ('author_badge_015','author_chars_500k',15),
  ('author_badge_016','author_completed_001',16),
  ('author_badge_017','author_completed_003',17),
  ('author_badge_018','author_completed_005',18),
  ('author_badge_019','author_novel_002',19),
  ('author_badge_020','author_novel_005',20),
  ('author_badge_021','author_novel_010',21),
  ('author_badge_022','author_unique_reader_010',22),
  ('author_badge_023','author_unique_reader_050',23),
  ('author_badge_024','author_unique_reader_100',24),
  ('author_badge_025','author_unique_reader_500',25),
  ('author_badge_026','author_favorite_010',26),
  ('author_badge_027','author_favorite_050',27),
  ('author_badge_028','author_favorite_100',28),
  ('author_badge_029','author_comment_010',29),
  ('author_badge_030','author_comment_050',30),
  ('author_badge_031','author_seed_received_001',31),
  ('author_badge_032','author_seed_received_010',32),
  ('author_badge_033','author_seed_received_050',33),
  ('author_badge_034','author_discovered_plus2_001',34),
  ('author_badge_035','author_discovered_plus3_001',35),
  ('author_badge_036','author_chars_1m',36),
  ('author_badge_037','author_completed_010',37),
  ('author_badge_038','author_unique_reader_1000',38),
  ('author_badge_039','author_favorite_500',39),
  ('author_badge_040','author_discovered_plus2_005',40)
)
insert into public.user_scout_badges (
  user_id, badge_id, progress_value, progress_percent, earned_at,
  status, is_public, metadata, created_at, updated_at
)
select
  b.user_id,
  m.new_id,
  b.progress_value,
  b.progress_percent,
  b.earned_at,
  b.status,
  b.is_public,
  b.metadata || pg_catalog.jsonb_build_object('migrated_from_badge_id', m.old_id),
  b.created_at,
  now()
from public.user_scout_badges b
join author_id_map m on m.old_id = b.badge_id
on conflict (user_id, badge_id) do update
  set progress_value = greatest(public.user_scout_badges.progress_value, excluded.progress_value),
      progress_percent = greatest(public.user_scout_badges.progress_percent, excluded.progress_percent),
      earned_at = case
        when public.user_scout_badges.earned_at is null then excluded.earned_at
        when excluded.earned_at is null then public.user_scout_badges.earned_at
        else least(public.user_scout_badges.earned_at, excluded.earned_at)
      end,
      status = case
        when public.user_scout_badges.status = 'earned' or excluded.status = 'earned' then 'earned'
        when public.user_scout_badges.status = 'revoked' then 'revoked'
        else excluded.status
      end,
      is_public = public.user_scout_badges.is_public,
      metadata = public.user_scout_badges.metadata || excluded.metadata,
      updated_at = now();

-- Canonical rows now contain the full progress/public/earned state. Remove the
-- provisional per-user aliases so admin/public aggregations cannot double-count.
with author_id_map(old_id, new_id, spec_no) as (
values
  ('author_badge_001','author_novel_001',1),
  ('author_badge_002','author_episode_001',2),
  ('author_badge_003','author_reader_001',3),
  ('author_badge_004','author_favorite_001',4),
  ('author_badge_005','author_comment_001',5),
  ('author_badge_006','author_episode_010',6),
  ('author_badge_007','author_episode_025',7),
  ('author_badge_008','author_episode_050',8),
  ('author_badge_009','author_episode_100',9),
  ('author_badge_010','author_episode_250',10),
  ('author_badge_011','author_chars_010k',11),
  ('author_badge_012','author_chars_050k',12),
  ('author_badge_013','author_chars_100k',13),
  ('author_badge_014','author_chars_250k',14),
  ('author_badge_015','author_chars_500k',15),
  ('author_badge_016','author_completed_001',16),
  ('author_badge_017','author_completed_003',17),
  ('author_badge_018','author_completed_005',18),
  ('author_badge_019','author_novel_002',19),
  ('author_badge_020','author_novel_005',20),
  ('author_badge_021','author_novel_010',21),
  ('author_badge_022','author_unique_reader_010',22),
  ('author_badge_023','author_unique_reader_050',23),
  ('author_badge_024','author_unique_reader_100',24),
  ('author_badge_025','author_unique_reader_500',25),
  ('author_badge_026','author_favorite_010',26),
  ('author_badge_027','author_favorite_050',27),
  ('author_badge_028','author_favorite_100',28),
  ('author_badge_029','author_comment_010',29),
  ('author_badge_030','author_comment_050',30),
  ('author_badge_031','author_seed_received_001',31),
  ('author_badge_032','author_seed_received_010',32),
  ('author_badge_033','author_seed_received_050',33),
  ('author_badge_034','author_discovered_plus2_001',34),
  ('author_badge_035','author_discovered_plus3_001',35),
  ('author_badge_036','author_chars_1m',36),
  ('author_badge_037','author_completed_010',37),
  ('author_badge_038','author_unique_reader_1000',38),
  ('author_badge_039','author_favorite_500',39),
  ('author_badge_040','author_discovered_plus2_005',40)
)
delete from public.user_scout_badges b
using author_id_map m
where b.badge_id = m.old_id;

insert into public.scout_badge_definitions (
  badge_id, badge_category, difficulty, display_name, description,
  metric_key, condition_type, target_value, condition_config, point_reward,
  is_limited, is_hidden, enabled, sort_order, metadata
) values
  ('reader_read_001','reader','easy','最初の一冊','有効読書 1作品','valid_read_work_count','threshold',1,'{}'::jsonb,1,false,false,true,1,pg_catalog.jsonb_build_object('spec_no',1,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_005','reader','easy','有効読書 5作品','有効読書 5作品','valid_read_work_count','threshold',5,'{}'::jsonb,1,false,false,true,2,pg_catalog.jsonb_build_object('spec_no',2,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_010','reader','easy','有効読書 10作品','有効読書 10作品','valid_read_work_count','threshold',10,'{}'::jsonb,1,false,false,true,3,pg_catalog.jsonb_build_object('spec_no',3,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_025','reader','easy','有効読書 25作品','有効読書 25作品','valid_read_work_count','threshold',25,'{}'::jsonb,1,false,false,true,4,pg_catalog.jsonb_build_object('spec_no',4,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_rating_001','reader','easy','初めての★評価','有効★評価 1作品','rating_work_count','threshold',1,'{}'::jsonb,1,false,false,true,5,pg_catalog.jsonb_build_object('spec_no',5,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_rating_005','reader','easy','有効★評価 5作品','有効★評価 5作品','rating_work_count','threshold',5,'{}'::jsonb,1,false,false,true,6,pg_catalog.jsonb_build_object('spec_no',6,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_rating_010','reader','easy','有効★評価 10作品','有効★評価 10作品','rating_work_count','threshold',10,'{}'::jsonb,1,false,false,true,7,pg_catalog.jsonb_build_object('spec_no',7,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_comment_001','reader','easy','初めてのコメント','有効コメント 1作品','comment_work_count','threshold',1,'{}'::jsonb,1,false,false,true,8,pg_catalog.jsonb_build_object('spec_no',8,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_comment_005','reader','easy','有効コメント 5作品','有効コメント 5作品','comment_work_count','threshold',5,'{}'::jsonb,1,false,false,true,9,pg_catalog.jsonb_build_object('spec_no',9,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_comment_010','reader','easy','有効コメント 10作品','有効コメント 10作品','comment_work_count','threshold',10,'{}'::jsonb,1,false,false,true,10,pg_catalog.jsonb_build_object('spec_no',10,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_001','reader','easy','初めてのLIGHT SEED','LIGHT SEED累計 1','seed_count','threshold',1,'{}'::jsonb,1,false,false,true,11,pg_catalog.jsonb_build_object('spec_no',11,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_003','reader','easy','LIGHT SEED 3','LIGHT SEED累計 3','seed_count','threshold',3,'{}'::jsonb,1,false,false,true,12,pg_catalog.jsonb_build_object('spec_no',12,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_005','reader','easy','LIGHT SEED 5','LIGHT SEED累計 5','seed_count','threshold',5,'{}'::jsonb,1,false,false,true,13,pg_catalog.jsonb_build_object('spec_no',13,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_010','reader','easy','LIGHT SEED 10','LIGHT SEED累計 10','seed_count','threshold',10,'{}'::jsonb,1,false,false,true,14,pg_catalog.jsonb_build_object('spec_no',14,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_bronze_seed_001','reader','easy','BRONZE SEED','BRONZE SEED 1回','bronze_seed_count','threshold',1,'{}'::jsonb,1,false,false,true,15,pg_catalog.jsonb_build_object('spec_no',15,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_silver_seed_001','reader','easy','SILVER SEED','SILVER SEED 1回','silver_seed_count','threshold',1,'{}'::jsonb,1,false,false,true,16,pg_catalog.jsonb_build_object('spec_no',16,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_gold_seed_001','reader','easy','GOLD SEED','GOLD SEED 1回','gold_seed_count','threshold',1,'{}'::jsonb,1,false,false,true,17,pg_catalog.jsonb_build_object('spec_no',17,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_001','reader','easy','+2 Rank発掘 1作品','+2 Rank発掘成功 1作品','discovery_plus2_count','threshold',1,'{}'::jsonb,1,false,false,true,18,pg_catalog.jsonb_build_object('spec_no',18,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_002','reader','easy','+2 Rank発掘 2作品','+2 Rank以上発掘成功 2作品','discovery_plus2_count','threshold',2,'{}'::jsonb,1,false,false,true,19,pg_catalog.jsonb_build_object('spec_no',19,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_003','reader','easy','+2 Rank発掘 3作品','+2 Rank以上発掘成功 3作品','discovery_plus2_count','threshold',3,'{}'::jsonb,1,false,false,true,20,pg_catalog.jsonb_build_object('spec_no',20,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_author_005','reader','easy','新規作者 5人','新規作者作品を5作者分有効読書','new_author_read_count','threshold',5,'{}'::jsonb,1,false,false,true,21,pg_catalog.jsonb_build_object('spec_no',21,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_author_010','reader','easy','新規作者 10人','新規作者作品を10作者分有効読書','new_author_read_count','threshold',10,'{}'::jsonb,1,false,false,true,22,pg_catalog.jsonb_build_object('spec_no',22,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_genre_003','reader','easy','3ジャンル読書','3ジャンルで有効読書','genre_count','threshold',3,'{}'::jsonb,1,false,false,true,23,pg_catalog.jsonb_build_object('spec_no',23,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_genre_005','reader','easy','5ジャンル読書','5ジャンルで有効読書','genre_count','threshold',5,'{}'::jsonb,1,false,false,true,24,pg_catalog.jsonb_build_object('spec_no',24,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_work_005','reader','easy','新着作品 5作品','新着作品を5作品有効読書','new_work_read_count','threshold',5,'{}'::jsonb,1,false,false,true,25,pg_catalog.jsonb_build_object('spec_no',25,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_low_rank_005','reader','easy','低Rank作品 5作品','低Rank作品を5作品有効読書','low_rank_read_count','threshold',5,'{}'::jsonb,1,false,false,true,26,pg_catalog.jsonb_build_object('spec_no',26,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_level_005','reader','easy','Scout Level 5','Scout Level 5到達','scout_level','threshold',5,'{}'::jsonb,1,false,false,true,27,pg_catalog.jsonb_build_object('spec_no',27,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_level_010','reader','easy','Scout Level 10','Scout Level 10到達','scout_level','threshold',10,'{}'::jsonb,1,false,false,true,28,pg_catalog.jsonb_build_object('spec_no',28,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_level_020','reader','easy','Scout Level 20','Scout Level 20到達','scout_level','threshold',20,'{}'::jsonb,1,false,false,true,29,pg_catalog.jsonb_build_object('spec_no',29,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_active_days_007','reader','easy','有効活動 7日','有効活動日 7日','active_day_count','threshold',7,'{}'::jsonb,1,false,false,true,30,pg_catalog.jsonb_build_object('spec_no',30,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_050','reader','normal','有効読書 50作品','有効読書 50作品','valid_read_work_count','threshold',50,'{}'::jsonb,5,false,false,true,31,pg_catalog.jsonb_build_object('spec_no',31,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_100','reader','normal','有効読書 100作品','有効読書 100作品','valid_read_work_count','threshold',100,'{}'::jsonb,5,false,false,true,32,pg_catalog.jsonb_build_object('spec_no',32,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_200','reader','normal','有効読書 200作品','有効読書 200作品','valid_read_work_count','threshold',200,'{}'::jsonb,5,false,false,true,33,pg_catalog.jsonb_build_object('spec_no',33,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_300','reader','normal','有効読書 300作品','有効読書 300作品','valid_read_work_count','threshold',300,'{}'::jsonb,5,false,false,true,34,pg_catalog.jsonb_build_object('spec_no',34,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_rating_025','reader','normal','有効★評価 25作品','有効★評価 25作品','rating_work_count','threshold',25,'{}'::jsonb,5,false,false,true,35,pg_catalog.jsonb_build_object('spec_no',35,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_rating_050','reader','normal','有効★評価 50作品','有効★評価 50作品','rating_work_count','threshold',50,'{}'::jsonb,5,false,false,true,36,pg_catalog.jsonb_build_object('spec_no',36,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_rating_100','reader','normal','有効★評価 100作品','有効★評価 100作品','rating_work_count','threshold',100,'{}'::jsonb,5,false,false,true,37,pg_catalog.jsonb_build_object('spec_no',37,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_comment_025','reader','normal','有効コメント 25作品','有効コメント 25作品','comment_work_count','threshold',25,'{}'::jsonb,5,false,false,true,38,pg_catalog.jsonb_build_object('spec_no',38,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_comment_050','reader','normal','有効コメント 50作品','有効コメント 50作品','comment_work_count','threshold',50,'{}'::jsonb,5,false,false,true,39,pg_catalog.jsonb_build_object('spec_no',39,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_comment_100','reader','normal','有効コメント 100作品','有効コメント 100作品','comment_work_count','threshold',100,'{}'::jsonb,5,false,false,true,40,pg_catalog.jsonb_build_object('spec_no',40,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_025','reader','normal','LIGHT SEED 25','LIGHT SEED累計25','seed_count','threshold',25,'{}'::jsonb,5,false,false,true,41,pg_catalog.jsonb_build_object('spec_no',41,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_050','reader','normal','LIGHT SEED 50','LIGHT SEED累計50','seed_count','threshold',50,'{}'::jsonb,5,false,false,true,42,pg_catalog.jsonb_build_object('spec_no',42,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_seed_100','reader','normal','LIGHT SEED 100','LIGHT SEED累計100','seed_count','threshold',100,'{}'::jsonb,5,false,false,true,43,pg_catalog.jsonb_build_object('spec_no',43,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_gold_seed_005','reader','normal','GOLD SEED 5','GOLD SEED累計5','gold_seed_count','threshold',5,'{}'::jsonb,5,false,false,true,44,pg_catalog.jsonb_build_object('spec_no',44,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_silver_seed_010','reader','normal','SILVER SEED 10','SILVER SEED累計10','silver_seed_count','threshold',10,'{}'::jsonb,5,false,false,true,45,pg_catalog.jsonb_build_object('spec_no',45,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_bronze_seed_015','reader','normal','BRONZE SEED 15','BRONZE SEED累計15','bronze_seed_count','threshold',15,'{}'::jsonb,5,false,false,true,46,pg_catalog.jsonb_build_object('spec_no',46,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_005','reader','normal','+2 Rank発掘 5作品','+2 Rank以上発掘 5作品','discovery_plus2_count','threshold',5,'{}'::jsonb,10,false,false,true,47,pg_catalog.jsonb_build_object('spec_no',47,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_010','reader','normal','+2 Rank発掘 10作品','+2 Rank以上発掘 10作品','discovery_plus2_count','threshold',10,'{}'::jsonb,10,false,false,true,48,pg_catalog.jsonb_build_object('spec_no',48,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_020','reader','normal','+2 Rank発掘 20作品','+2 Rank以上発掘 20作品','discovery_plus2_count','threshold',20,'{}'::jsonb,10,false,false,true,49,pg_catalog.jsonb_build_object('spec_no',49,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus3_001','reader','normal','+3 Rank発掘 1作品','+3 Rank以上発掘 1作品','discovery_plus3_count','threshold',1,'{}'::jsonb,10,false,false,true,50,pg_catalog.jsonb_build_object('spec_no',50,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus3_005','reader','normal','+3 Rank発掘 5作品','+3 Rank以上発掘 5作品','discovery_plus3_count','threshold',5,'{}'::jsonb,10,false,false,true,51,pg_catalog.jsonb_build_object('spec_no',51,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus3_010','reader','normal','+3 Rank発掘 10作品','+3 Rank以上発掘 10作品','discovery_plus3_count','threshold',10,'{}'::jsonb,10,false,false,true,52,pg_catalog.jsonb_build_object('spec_no',52,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus4_001','reader','normal','+4 Rank発掘 1作品','+4 Rank以上発掘 1作品','discovery_plus4_count','threshold',1,'{}'::jsonb,10,false,false,true,53,pg_catalog.jsonb_build_object('spec_no',53,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus4_002','reader','normal','+4 Rank発掘 2作品','+4 Rank以上発掘 2作品','discovery_plus4_count','threshold',2,'{}'::jsonb,10,false,false,true,54,pg_catalog.jsonb_build_object('spec_no',54,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus4_005','reader','normal','+4 Rank発掘 5作品','+4 Rank以上発掘 5作品','discovery_plus4_count','threshold',5,'{}'::jsonb,10,false,false,true,55,pg_catalog.jsonb_build_object('spec_no',55,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_nova_001','reader','normal','NOVA予見 1回','NOVA予見 1回','nova_prediction_count','threshold',1,'{}'::jsonb,10,false,false,true,56,pg_catalog.jsonb_build_object('spec_no',56,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_nova_003','reader','normal','NOVA予見 3回','NOVA予見 3回','nova_prediction_count','threshold',3,'{}'::jsonb,10,false,false,true,57,pg_catalog.jsonb_build_object('spec_no',57,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_nova_005','reader','normal','NOVA予見 5回','NOVA予見 5回','nova_prediction_count','threshold',5,'{}'::jsonb,10,false,false,true,58,pg_catalog.jsonb_build_object('spec_no',58,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_author_025','reader','normal','新規作者 25人','新規作者25人の作品を有効読書','new_author_read_count','threshold',25,'{}'::jsonb,5,false,false,true,59,pg_catalog.jsonb_build_object('spec_no',59,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_author_050','reader','normal','新規作者 50人','新規作者50人の作品を有効読書','new_author_read_count','threshold',50,'{}'::jsonb,5,false,false,true,60,pg_catalog.jsonb_build_object('spec_no',60,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_author_100','reader','normal','新規作者 100人','新規作者100人の作品を有効読書','new_author_read_count','threshold',100,'{}'::jsonb,5,false,false,true,61,pg_catalog.jsonb_build_object('spec_no',61,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_low_rank_025','reader','normal','低Rank作品 25作品','低Rank作品25作品を有効読書','low_rank_read_count','threshold',25,'{}'::jsonb,5,false,false,true,62,pg_catalog.jsonb_build_object('spec_no',62,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_low_rank_050','reader','normal','低Rank作品 50作品','低Rank作品50作品を有効読書','low_rank_read_count','threshold',50,'{}'::jsonb,5,false,false,true,63,pg_catalog.jsonb_build_object('spec_no',63,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_low_rank_100','reader','normal','低Rank作品 100作品','低Rank作品100作品を有効読書','low_rank_read_count','threshold',100,'{}'::jsonb,5,false,false,true,64,pg_catalog.jsonb_build_object('spec_no',64,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_work_025','reader','normal','新着作品 25作品','新着作品25作品を有効読書','new_work_read_count','threshold',25,'{}'::jsonb,5,false,false,true,65,pg_catalog.jsonb_build_object('spec_no',65,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_work_050','reader','normal','新着作品 50作品','新着作品50作品を有効読書','new_work_read_count','threshold',50,'{}'::jsonb,5,false,false,true,66,pg_catalog.jsonb_build_object('spec_no',66,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_work_100','reader','normal','新着作品 100作品','新着作品100作品を有効読書','new_work_read_count','threshold',100,'{}'::jsonb,5,false,false,true,67,pg_catalog.jsonb_build_object('spec_no',67,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_genre_008','reader','normal','8ジャンル読書','8ジャンルで有効読書','genre_count','threshold',8,'{}'::jsonb,5,false,false,true,68,pg_catalog.jsonb_build_object('spec_no',68,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_genre_010','reader','normal','10ジャンル読書','10ジャンルで有効読書','genre_count','threshold',10,'{}'::jsonb,5,false,false,true,69,pg_catalog.jsonb_build_object('spec_no',69,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_long_read_005','reader','normal','長編読書 5作品','長編作品を5作品 qualified_long_read','qualified_long_read_count','threshold',5,'{}'::jsonb,5,false,false,true,70,pg_catalog.jsonb_build_object('spec_no',70,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_long_read_010','reader','normal','長編読書 10作品','長編作品を10作品 qualified_long_read','qualified_long_read_count','threshold',10,'{}'::jsonb,5,false,false,true,71,pg_catalog.jsonb_build_object('spec_no',71,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_short_read_010','reader','normal','短編読了 10作品','短編作品を10作品読了','qualified_short_read_count','threshold',10,'{}'::jsonb,5,false,false,true,72,pg_catalog.jsonb_build_object('spec_no',72,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_short_read_025','reader','normal','短編読了 25作品','短編作品を25作品読了','qualified_short_read_count','threshold',25,'{}'::jsonb,5,false,false,true,73,pg_catalog.jsonb_build_object('spec_no',73,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_completed_read_005','reader','normal','完結作品読了 5作品','完結作品5作品読了','completed_read_count','threshold',5,'{}'::jsonb,5,false,false,true,74,pg_catalog.jsonb_build_object('spec_no',74,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_completed_read_010','reader','normal','完結作品読了 10作品','完結作品10作品読了','completed_read_count','threshold',10,'{}'::jsonb,5,false,false,true,75,pg_catalog.jsonb_build_object('spec_no',75,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_active_days_030','reader','normal','有効活動 30日','有効活動日30日','active_day_count','threshold',30,'{}'::jsonb,5,false,false,true,76,pg_catalog.jsonb_build_object('spec_no',76,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_active_days_090','reader','normal','有効活動 90日','有効活動日90日','active_day_count','threshold',90,'{}'::jsonb,5,false,false,true,77,pg_catalog.jsonb_build_object('spec_no',77,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_level_030','reader','normal','Scout Level 30','Scout Level 30到達','scout_level','threshold',30,'{}'::jsonb,10,false,false,true,78,pg_catalog.jsonb_build_object('spec_no',78,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_point_100','reader','normal','Scout Point 100','累計Scout Point獲得量100pt','scout_point_earned_total','threshold',100,'{}'::jsonb,0,false,false,true,79,pg_catalog.jsonb_build_object('spec_no',79,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_point_500','reader','normal','Scout Point 500','累計Scout Point獲得量500pt','scout_point_earned_total','threshold',500,'{}'::jsonb,0,false,false,true,80,pg_catalog.jsonb_build_object('spec_no',80,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_500','reader','hard','有効読書 500作品','有効読書500作品','valid_read_work_count','threshold',500,'{}'::jsonb,25,false,false,true,81,pg_catalog.jsonb_build_object('spec_no',81,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_read_1000','reader','hard','有効読書 1,000作品','有効読書1,000作品','valid_read_work_count','threshold',1000,'{}'::jsonb,25,false,false,true,82,pg_catalog.jsonb_build_object('spec_no',82,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_new_author_250','reader','hard','新規作者 250人','新規作者250人の作品を有効読書','new_author_read_count','threshold',250,'{}'::jsonb,25,false,false,true,83,pg_catalog.jsonb_build_object('spec_no',83,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_low_rank_250','reader','hard','低Rank作品 250作品','低Rank作品250作品を有効読書','low_rank_read_count','threshold',250,'{}'::jsonb,25,false,false,true,84,pg_catalog.jsonb_build_object('spec_no',84,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_low_rank_500','reader','hard','低Rank作品 500作品','低Rank作品500作品を有効読書','low_rank_read_count','threshold',500,'{}'::jsonb,25,false,false,true,85,pg_catalog.jsonb_build_object('spec_no',85,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_050','reader','hard','+2 Rank発掘 50作品','+2 Rank以上発掘50作品','discovery_plus2_count','threshold',50,'{}'::jsonb,25,false,false,true,86,pg_catalog.jsonb_build_object('spec_no',86,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus2_100','reader','hard','+2 Rank発掘 100作品','+2 Rank以上発掘100作品','discovery_plus2_count','threshold',100,'{}'::jsonb,25,false,false,true,87,pg_catalog.jsonb_build_object('spec_no',87,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus3_025','reader','hard','+3 Rank発掘 25作品','+3 Rank以上発掘25作品','discovery_plus3_count','threshold',25,'{}'::jsonb,25,false,false,true,88,pg_catalog.jsonb_build_object('spec_no',88,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus3_050','reader','hard','+3 Rank発掘 50作品','+3 Rank以上発掘50作品','discovery_plus3_count','threshold',50,'{}'::jsonb,25,false,false,true,89,pg_catalog.jsonb_build_object('spec_no',89,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus4_010','reader','hard','+4 Rank発掘 10作品','+4 Rank以上発掘10作品','discovery_plus4_count','threshold',10,'{}'::jsonb,25,false,false,true,90,pg_catalog.jsonb_build_object('spec_no',90,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus4_020','reader','hard','+4 Rank発掘 20作品','+4 Rank以上発掘20作品','discovery_plus4_count','threshold',20,'{}'::jsonb,25,false,false,true,91,pg_catalog.jsonb_build_object('spec_no',91,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus5_001','reader','hard','+5 Rank発掘 1作品','+5 Rank発掘1作品','discovery_plus5_count','threshold',1,'{}'::jsonb,25,false,false,true,92,pg_catalog.jsonb_build_object('spec_no',92,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus5_003','reader','hard','+5 Rank発掘 3作品','+5 Rank発掘3作品','discovery_plus5_count','threshold',3,'{}'::jsonb,25,false,false,true,93,pg_catalog.jsonb_build_object('spec_no',93,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_discovery_plus5_010','reader','hard','+5 Rank発掘 10作品','+5 Rank発掘10作品','discovery_plus5_count','threshold',10,'{}'::jsonb,25,false,false,true,94,pg_catalog.jsonb_build_object('spec_no',94,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_nova_010','reader','hard','NOVA予見 10回','NOVA予見10回','nova_prediction_count','threshold',10,'{}'::jsonb,25,false,false,true,95,pg_catalog.jsonb_build_object('spec_no',95,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_nova_025','reader','hard','NOVA予見 25回','NOVA予見25回','nova_prediction_count','threshold',25,'{}'::jsonb,25,false,false,true,96,pg_catalog.jsonb_build_object('spec_no',96,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_gold_plus5_001','reader','hard','GOLD +5 Rank発掘','GOLD SEEDから+5 Rank発掘を1回成立','gold_plus5_count','threshold',1,'{}'::jsonb,25,false,false,true,97,pg_catalog.jsonb_build_object('spec_no',97,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_silver_plus5_001','reader','hard','SILVER +5 Rank発掘','SILVER SEEDから+5 Rank発掘を1回成立','silver_plus5_count','threshold',1,'{}'::jsonb,25,false,false,true,98,pg_catalog.jsonb_build_object('spec_no',98,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_bronze_plus5_001','reader','hard','BRONZE +5 Rank発掘','BRONZE SEEDから+5 Rank発掘を1回成立','bronze_plus5_count','threshold',1,'{}'::jsonb,25,false,false,true,99,pg_catalog.jsonb_build_object('spec_no',99,'spec_version','badge-system-beta-2026-09-21')),
  ('reader_master_scout','reader','hard','総合最高実績','+5 Rank発掘10作品、NOVA予見10回、新規作者100人以上、10ジャンル以上をすべて達成','composite_master_scout','composite_all',4,
    '{"components":[{"metric_key":"discovery_plus5_count","target":10,"label":"+5 Rank発掘"},{"metric_key":"nova_prediction_count","target":10,"label":"NOVA予見"},{"metric_key":"new_author_read_count","target":100,"label":"新規作者"},{"metric_key":"genre_count","target":10,"label":"ジャンル"}]}'::jsonb,
    25,false,false,true,100,pg_catalog.jsonb_build_object('spec_no',100,'spec_version','badge-system-beta-2026-09-21'))
on conflict (badge_id) do update
  set badge_category = excluded.badge_category,
      difficulty = excluded.difficulty,
      display_name = excluded.display_name,
      description = excluded.description,
      metric_key = excluded.metric_key,
      condition_type = excluded.condition_type,
      target_value = excluded.target_value,
      condition_config = excluded.condition_config,
      point_reward = excluded.point_reward,
      is_limited = false,
      is_hidden = excluded.is_hidden,
      enabled = true,
      sort_order = excluded.sort_order,
      metadata = public.scout_badge_definitions.metadata || excluded.metadata,
      updated_at = now();

create or replace function public.novelight_reader_badge_metrics(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_new_author_days integer;
  v_new_work_days integer;
  v_low_rank_threshold integer;
  v_long_chars integer;
  v_long_valid_episodes integer;
  v_short_chars integer;
  v_completed_ratio numeric;

  v_read bigint := 0;
  v_rating bigint := 0;
  v_comment bigint := 0;
  v_seed bigint := 0;
  v_gold bigint := 0;
  v_silver bigint := 0;
  v_bronze bigint := 0;
  v_plus2 bigint := 0;
  v_plus3 bigint := 0;
  v_plus4 bigint := 0;
  v_plus5 bigint := 0;
  v_nova bigint := 0;
  v_gold_plus5 bigint := 0;
  v_silver_plus5 bigint := 0;
  v_bronze_plus5 bigint := 0;
  v_new_author bigint := 0;
  v_new_work bigint := 0;
  v_low_rank bigint := 0;
  v_genres bigint := 0;
  v_long_read bigint := 0;
  v_short_read bigint := 0;
  v_completed_read bigint := 0;
  v_active_days bigint := 0;
  v_level bigint := 1;
  v_point_earned bigint := 0;
  v_cap bigint := 0;
  v_xp bigint := 0;
begin
  if p_user_id is null then
    return '{}'::jsonb;
  end if;

  select c.badge_settings into v_settings
    from public.scout_badge_runtime_config c where c.id = 1;

  v_new_author_days := greatest(coalesce((v_settings->>'new_author_days')::integer, 30), 1);
  v_new_work_days := greatest(coalesce((v_settings->>'new_work_days')::integer, 7), 1);
  v_low_rank_threshold := least(greatest(coalesce((v_settings->>'low_rank_threshold')::integer, 2), 1), 6);
  v_long_chars := greatest(coalesce((v_settings->>'long_chars')::integer, 100000), 1);
  v_long_valid_episodes := greatest(coalesce((v_settings->>'long_valid_episodes')::integer, 5), 1);
  v_short_chars := greatest(coalesce((v_settings->>'short_chars')::integer, 20000), 1);
  v_completed_ratio := least(greatest(coalesce((v_settings->>'completed_read_ratio')::numeric, 0.80), 0.01), 1.00);

  select count(distinct v.novel_id_snapshot)::bigint into v_read
    from public.valid_read_events v
   where v.reader_id = p_user_id;

  select count(*)::bigint into v_rating
    from public.novel_star_ratings r
    join public.novels n on n.id::text = r.novel_id_snapshot
   where r.user_id = p_user_id
     and n.status = 'published'
     and n.user_id <> p_user_id;

  select count(distinct c.novel_id)::bigint into v_comment
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.user_id = p_user_id
     and c.deleted_at is null
     and c.author_hidden_at is null
     and n.status = 'published'
     and n.user_id <> p_user_id;

  select
    count(*)::bigint,
    count(*) filter (where s.seed_type = 'GOLD')::bigint,
    count(*) filter (where s.seed_type = 'SILVER')::bigint,
    count(*) filter (where s.seed_type = 'BRONZE')::bigint
  into v_seed, v_gold, v_silver, v_bronze
  from public.light_seeds s
  where s.reader_id = p_user_id;

  select
    count(*) filter (where d.best_rank_delta >= 2)::bigint,
    count(*) filter (where d.best_rank_delta >= 3)::bigint,
    count(*) filter (where d.best_rank_delta >= 4)::bigint,
    count(*) filter (where d.best_rank_delta >= 5)::bigint,
    count(*) filter (where d.rank_at_seed = 5 and d.highest_rank_seen = 6)::bigint,
    count(*) filter (where d.seed_type = 'GOLD' and d.best_rank_delta >= 5)::bigint,
    count(*) filter (where d.seed_type = 'SILVER' and d.best_rank_delta >= 5)::bigint,
    count(*) filter (where d.seed_type = 'BRONZE' and d.best_rank_delta >= 5)::bigint
  into v_plus2, v_plus3, v_plus4, v_plus5, v_nova,
       v_gold_plus5, v_silver_plus5, v_bronze_plus5
  from public.seed_discovery_state d
  where d.reader_id = p_user_id;

  with author_first as (
    select n.user_id, min(n.first_published_at) as first_published_at
      from public.novels n
     where n.first_published_at is not null
     group by n.user_id
  )
  select count(distinct v.author_id_snapshot)::bigint into v_new_author
    from public.valid_read_events v
    join author_first a on a.user_id = v.author_id_snapshot
   where v.reader_id = p_user_id
     and v.qualified_at >= a.first_published_at
     and v.qualified_at < a.first_published_at
       + pg_catalog.make_interval(days => v_new_author_days);

  select count(distinct v.novel_id_snapshot)::bigint into v_new_work
    from public.valid_read_events v
    join public.novels n on n.id::text = v.novel_id_snapshot
   where v.reader_id = p_user_id
     and n.first_published_at is not null
     and v.qualified_at >= n.first_published_at
     and v.qualified_at < n.first_published_at
       + pg_catalog.make_interval(days => v_new_work_days);

  select count(distinct x.novel_id_snapshot)::bigint into v_low_rank
    from (
      select
        v.novel_id_snapshot,
        (
          select re.to_rank
            from public.novel_rank_events re
           where re.novel_id_snapshot = v.novel_id_snapshot
             and re.occurred_at <= v.qualified_at
           order by re.occurred_at desc, re.id desc
           limit 1
        ) as rank_at_read
      from public.valid_read_events v
      where v.reader_id = p_user_id
    ) x
   where x.rank_at_read is not null
     and x.rank_at_read <= v_low_rank_threshold;

  select count(distinct n.genre)::bigint into v_genres
    from (
      select distinct v.novel_id_snapshot
        from public.valid_read_events v
       where v.reader_id = p_user_id
    ) r
    join public.novels n on n.id::text = r.novel_id_snapshot
   where n.status = 'published'
     and n.genre is not null
     and pg_catalog.btrim(n.genre) <> '';

  with work_stats as (
    select
      n.id::text as novel_id,
      coalesce(sum(pg_catalog.char_length(coalesce(e.content, ''))), 0)::bigint as published_chars,
      count(e.id)::bigint as published_episodes,
      (pg_catalog.array_agg(e.id::text order by e.episode_number desc, e.id desc))[1] as final_episode_id,
      coalesce(rs.is_completed, false) as is_completed
    from public.novels n
    join public.episodes e
      on e.novel_id = n.id
     and e.status = 'published'
    left join public.novel_rank_state rs
      on rs.novel_id_snapshot = n.id::text
    where n.status = 'published'
    group by n.id, rs.is_completed
  ),
  reader_stats as (
    select
      w.*,
      count(v.id)::bigint as valid_read_episodes,
      coalesce(bool_or(v.episode_id_snapshot = w.final_episode_id), false) as read_final_episode
    from work_stats w
    left join public.valid_read_events v
      on v.reader_id = p_user_id
     and v.novel_id_snapshot = w.novel_id
    group by
      w.novel_id, w.published_chars, w.published_episodes,
      w.final_episode_id, w.is_completed
  )
  select
    count(*) filter (
      where r.published_chars >= v_long_chars
        and r.valid_read_episodes >= v_long_valid_episodes
    )::bigint,
    count(*) filter (
      where r.is_completed
        and r.read_final_episode
        and r.published_episodes > 0
        and r.valid_read_episodes::numeric / r.published_episodes::numeric >= v_completed_ratio
        and r.published_chars <= v_short_chars
    )::bigint,
    count(*) filter (
      where r.is_completed
        and r.read_final_episode
        and r.published_episodes > 0
        and r.valid_read_episodes::numeric / r.published_episodes::numeric >= v_completed_ratio
    )::bigint
  into v_long_read, v_short_read, v_completed_read
  from reader_stats r;

  select count(distinct a.activity_day)::bigint into v_active_days
  from (
    select pg_catalog.timezone('Asia/Tokyo', v.qualified_at)::date as activity_day
      from public.valid_read_events v
     where v.reader_id = p_user_id
    union
    select pg_catalog.timezone('Asia/Tokyo', r.first_rated_at)::date
      from public.novel_star_ratings r
     where r.user_id = p_user_id
    union
    select pg_catalog.timezone('Asia/Tokyo', c.created_at)::date
      from public.novel_comments c
      join public.novels n on n.id = c.novel_id
     where c.user_id = p_user_id
       and c.deleted_at is null
       and c.author_hidden_at is null
       and n.user_id <> p_user_id
    union
    select pg_catalog.timezone('Asia/Tokyo', s.seeded_at)::date
      from public.light_seeds s
     where s.reader_id = p_user_id
  ) a
  where a.activity_day is not null;

  select t.cumulative_xp::bigint into v_cap
    from public.scout_level_thresholds t where t.level = 30;

  select least(coalesce(sum(x.xp_value), 0)::bigint, coalesce(v_cap, 0))
    into v_xp
    from public.scout_xp_ledger x
   where x.user_id = p_user_id;

  v_level := public.novelight_scout_level_for_xp(greatest(v_xp, 0));

  select coalesce(sum(p.point_value) filter (
           where p.status = 'confirmed' and p.point_value > 0
         ), 0)::bigint
    into v_point_earned
    from public.scout_point_ledger p
   where p.user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'valid_read_work_count', v_read,
    'rating_work_count', v_rating,
    'comment_work_count', v_comment,
    'seed_count', v_seed,
    'gold_seed_count', v_gold,
    'silver_seed_count', v_silver,
    'bronze_seed_count', v_bronze,
    'discovery_plus2_count', v_plus2,
    'discovery_plus3_count', v_plus3,
    'discovery_plus4_count', v_plus4,
    'discovery_plus5_count', v_plus5,
    'nova_prediction_count', v_nova,
    'gold_plus5_count', v_gold_plus5,
    'silver_plus5_count', v_silver_plus5,
    'bronze_plus5_count', v_bronze_plus5,
    'new_author_read_count', v_new_author,
    'new_work_read_count', v_new_work,
    'low_rank_read_count', v_low_rank,
    'genre_count', v_genres,
    'qualified_long_read_count', v_long_read,
    'qualified_short_read_count', v_short_read,
    'completed_read_count', v_completed_read,
    'active_day_count', v_active_days,
    'scout_level', v_level,
    'scout_point_earned_total', v_point_earned
  );
end
$$;

revoke all on function public.novelight_reader_badge_metrics(uuid)
  from public, anon, authenticated;

create or replace function public.novelight_author_badge_metrics(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_works bigint := 0;
  v_episodes bigint := 0;
  v_words bigint := 0;
  v_completed bigint := 0;
  v_readers bigint := 0;
  v_favorites bigint := 0;
  v_comments bigint := 0;
  v_seeds bigint := 0;
  v_plus2 bigint := 0;
  v_plus3 bigint := 0;
begin
  if p_user_id is null then
    return '{}'::jsonb;
  end if;

  select count(*)::bigint into v_works
    from public.novels n
   where n.user_id = p_user_id
     and n.status = 'published';

  select
    count(e.id)::bigint,
    coalesce(sum(pg_catalog.char_length(coalesce(e.content, ''))), 0)::bigint
  into v_episodes, v_words
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where n.user_id = p_user_id
    and n.status = 'published'
    and e.status = 'published';

  select count(*)::bigint into v_completed
    from public.novel_rank_state rs
    join public.novels n on n.id::text = rs.novel_id_snapshot
   where n.user_id = p_user_id
     and n.status = 'published'
     and rs.is_completed;

  select count(distinct v.reader_id)::bigint into v_readers
    from public.valid_read_events v
    join public.novels n on n.id::text = v.novel_id_snapshot
   where n.user_id = p_user_id
     and n.status = 'published'
     and v.reader_id <> p_user_id;

  select count(*)::bigint into v_favorites
    from public.favorites f
    join public.novels n on n.id = f.novel_id
   where n.user_id = p_user_id
     and n.status = 'published'
     and f.user_id <> p_user_id;

  select count(*)::bigint into v_comments
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where n.user_id = p_user_id
     and n.status = 'published'
     and c.user_id <> p_user_id
     and c.deleted_at is null
     and c.author_hidden_at is null;

  select count(*)::bigint into v_seeds
    from public.light_seeds s
    join public.novels n on n.id::text = s.novel_id_snapshot
   where n.user_id = p_user_id
     and n.status = 'published';

  select
    count(distinct d.novel_id_snapshot) filter (where d.best_rank_delta >= 2)::bigint,
    count(distinct d.novel_id_snapshot) filter (where d.best_rank_delta >= 3)::bigint
  into v_plus2, v_plus3
  from public.seed_discovery_state d
  join public.novels n on n.id::text = d.novel_id_snapshot
  where n.user_id = p_user_id
    and n.status = 'published';

  return pg_catalog.jsonb_build_object(
    'author_work_published', v_works,
    'author_episode_published', v_episodes,
    'author_words_published', v_words,
    'author_works_completed', v_completed,
    'author_unique_readers', v_readers,
    'author_favorites_received', v_favorites,
    'author_comments_received', v_comments,
    'author_seeds_received', v_seeds,
    'author_seed_growth_plus2_works', v_plus2,
    'author_seed_growth_plus3_works', v_plus3
  );
end
$$;

revoke all on function public.novelight_author_badge_metrics(uuid)
  from public, anon, authenticated;

create or replace function public.novelight_evaluate_scout_badge(
  p_badge_id text,
  p_metrics jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_definition public.scout_badge_definitions%rowtype;
  v_value numeric := 0;
  v_percent numeric := 0;
  v_earned boolean := false;
  v_progress bigint := 0;
  v_component jsonb;
  v_component_key text;
  v_component_label text;
  v_component_value numeric;
  v_component_target numeric;
  v_component_percent numeric;
  v_component_count integer := 0;
  v_component_completed integer := 0;
  v_component_percent_sum numeric := 0;
  v_component_rows jsonb := '[]'::jsonb;
begin
  select * into v_definition
    from public.scout_badge_definitions d
   where d.badge_id = p_badge_id
     and d.enabled;

  if not found then
    return null;
  end if;

  if v_definition.condition_type in ('counter','threshold','boolean') then
    begin
      v_value := coalesce(nullif(coalesce(p_metrics, '{}'::jsonb)->>v_definition.metric_key, ''), '0')::numeric;
    exception when invalid_text_representation then
      v_value := 0;
    end;

    v_progress := greatest(pg_catalog.floor(v_value), 0)::bigint;
    v_percent := least(
      100::numeric,
      pg_catalog.round(
        (greatest(v_value, 0) / greatest(v_definition.target_value, 1)::numeric) * 100,
        2
      )
    );
    v_earned := v_value >= v_definition.target_value;

    return pg_catalog.jsonb_build_object(
      'progress_value', v_progress,
      'progress_percent', v_percent,
      'earned', v_earned,
      'metadata', '{}'::jsonb
    );
  end if;

  if v_definition.condition_type = 'composite_all' then
    for v_component in
      select value
        from pg_catalog.jsonb_array_elements(
          coalesce(v_definition.condition_config->'components', '[]'::jsonb)
        )
    loop
      v_component_key := v_component->>'metric_key';
      v_component_label := coalesce(v_component->>'label', v_component_key);
      v_component_target := greatest(coalesce((v_component->>'target')::numeric, 1), 1);
      begin
        v_component_value := coalesce(
          nullif(coalesce(p_metrics, '{}'::jsonb)->>v_component_key, ''),
          '0'
        )::numeric;
      exception when invalid_text_representation then
        v_component_value := 0;
      end;
      v_component_percent := least(
        100::numeric,
        pg_catalog.round(
          (greatest(v_component_value, 0) / v_component_target) * 100,
          2
        )
      );
      v_component_count := v_component_count + 1;
      if v_component_value >= v_component_target then
        v_component_completed := v_component_completed + 1;
      end if;
      v_component_percent_sum := v_component_percent_sum + v_component_percent;
      v_component_rows := v_component_rows || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'metric_key', v_component_key,
          'label', v_component_label,
          'current', greatest(pg_catalog.floor(v_component_value), 0)::bigint,
          'target', v_component_target,
          'percent', v_component_percent
        )
      );
    end loop;

    v_progress := v_component_completed;
    v_percent := case
      when v_component_count = 0 then 0
      else pg_catalog.round(v_component_percent_sum / v_component_count, 2)
    end;
    v_earned := v_component_count > 0
      and v_component_completed = v_component_count;

    return pg_catalog.jsonb_build_object(
      'progress_value', v_progress,
      'progress_percent', v_percent,
      'earned', v_earned,
      'metadata', pg_catalog.jsonb_build_object(
        'composite_progress', v_component_rows,
        'composite_completed', v_component_completed,
        'composite_total', v_component_count
      )
    );
  end if;

  return null;
end
$$;

revoke all on function public.novelight_evaluate_scout_badge(text, jsonb)
  from public, anon, authenticated;

create or replace function public.novelight_apply_scout_badge_evaluation(
  p_user_id uuid,
  p_badge_id text,
  p_progress_value bigint,
  p_progress_percent numeric,
  p_earned boolean,
  p_metadata jsonb,
  p_award_points boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition public.scout_badge_definitions%rowtype;
  v_existing public.user_scout_badges%rowtype;
  v_progress bigint := greatest(coalesce(p_progress_value, 0), 0);
  v_percent numeric := least(greatest(coalesce(p_progress_percent, 0), 0), 100);
  v_is_earned boolean := coalesce(p_earned, false);
  v_newly_earned boolean := false;
begin
  select * into v_definition
    from public.scout_badge_definitions d
   where d.badge_id = p_badge_id
     and d.enabled;

  if not found or p_user_id is null then
    return false;
  end if;

  select * into v_existing
    from public.user_scout_badges b
   where b.user_id = p_user_id
     and b.badge_id = p_badge_id;

  if found and v_existing.status = 'revoked' then
    return false;
  end if;

  if v_existing.user_id is not null and v_existing.status = 'earned' then
    v_is_earned := true;
    v_progress := greatest(v_progress, v_existing.progress_value);
    v_percent := 100;
  end if;

  v_newly_earned := v_is_earned
    and coalesce(v_existing.status <> 'earned', true);

  insert into public.user_scout_badges (
    user_id, badge_id, progress_value, progress_percent, earned_at,
    status, is_public, metadata, updated_at
  ) values (
    p_user_id,
    p_badge_id,
    v_progress,
    case when v_is_earned then 100 else v_percent end,
    case when v_is_earned then now() else null end,
    case when v_is_earned then 'earned' else 'in_progress' end,
    true,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (user_id, badge_id) do update
    set progress_value = case
          when public.user_scout_badges.status = 'earned'
            then greatest(public.user_scout_badges.progress_value, excluded.progress_value)
          else excluded.progress_value
        end,
        progress_percent = case
          when public.user_scout_badges.status = 'earned' then 100
          else excluded.progress_percent
        end,
        earned_at = coalesce(public.user_scout_badges.earned_at, excluded.earned_at),
        status = case
          when public.user_scout_badges.status = 'earned' then 'earned'
          else excluded.status
        end,
        metadata = public.user_scout_badges.metadata || excluded.metadata,
        updated_at = now();

  if v_newly_earned
     and coalesce(p_award_points, false)
     and v_definition.badge_category = 'reader'
     and v_definition.point_reward > 0 then
    insert into public.scout_point_ledger (
      user_id, point_kind, point_value, status, event_key, occurred_at, metadata
    ) values (
      p_user_id,
      'badge',
      v_definition.point_reward,
      'confirmed',
      'badge:' || p_user_id::text || ':' || p_badge_id,
      now(),
      pg_catalog.jsonb_build_object(
        'badge_id', p_badge_id,
        'reason_type', 'badge_reward',
        'reason_id', p_badge_id,
        'display_name', v_definition.display_name,
        'rule_version', 'badge-system-beta-2026-09-21'
      )
    )
    on conflict (event_key) do nothing;
  end if;

  return v_newly_earned;
end
$$;

revoke all on function public.novelight_apply_scout_badge_evaluation(
  uuid, text, bigint, numeric, boolean, jsonb, boolean
) from public, anon, authenticated;

create or replace function public.novelight_refresh_scout_badges_for_user(
  p_user_id uuid,
  p_award_reader_points boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition record;
  v_metrics jsonb;
  v_eval jsonb;
  v_count integer := 0;
  v_founding_number bigint;
  v_beta_qualified_at timestamptz;
begin
  if p_user_id is null then
    return 0;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:badge-refresh:' || p_user_id::text, 0)
  );

  v_metrics := public.novelight_reader_badge_metrics(p_user_id);

  for v_definition in
    select d.badge_id
      from public.scout_badge_definitions d
     where d.enabled
       and d.badge_category = 'reader'
     order by d.sort_order
  loop
    v_eval := public.novelight_evaluate_scout_badge(v_definition.badge_id, v_metrics);
    if v_eval is not null then
      perform public.novelight_apply_scout_badge_evaluation(
        p_user_id,
        v_definition.badge_id,
        coalesce((v_eval->>'progress_value')::bigint, 0),
        coalesce((v_eval->>'progress_percent')::numeric, 0),
        coalesce((v_eval->>'earned')::boolean, false),
        coalesce(v_eval->'metadata', '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
            'metric_source', 'authoritative',
            'retroactive_point_award', coalesce(p_award_reader_points, false)
          ),
        p_award_reader_points
      );
      v_count := v_count + 1;
    end if;
  end loop;

  -- Badge rewards can themselves increase cumulative Scout Point. Recompute only
  -- the Point-threshold badges after all Reader rewards in this pass; they award 0.
  v_metrics := public.novelight_reader_badge_metrics(p_user_id);
  for v_definition in
    select d.badge_id
      from public.scout_badge_definitions d
     where d.enabled
       and d.badge_category = 'reader'
       and d.metric_key = 'scout_point_earned_total'
  loop
    v_eval := public.novelight_evaluate_scout_badge(v_definition.badge_id, v_metrics);
    perform public.novelight_apply_scout_badge_evaluation(
      p_user_id,
      v_definition.badge_id,
      coalesce((v_eval->>'progress_value')::bigint, 0),
      coalesce((v_eval->>'progress_percent')::numeric, 0),
      coalesce((v_eval->>'earned')::boolean, false),
      coalesce(v_eval->'metadata', '{}'::jsonb),
      false
    );
  end loop;

  v_metrics := public.novelight_author_badge_metrics(p_user_id);
  for v_definition in
    select d.badge_id
      from public.scout_badge_definitions d
     where d.enabled
       and d.badge_category = 'author'
     order by d.sort_order
  loop
    v_eval := public.novelight_evaluate_scout_badge(v_definition.badge_id, v_metrics);
    if v_eval is not null then
      perform public.novelight_apply_scout_badge_evaluation(
        p_user_id,
        v_definition.badge_id,
        coalesce((v_eval->>'progress_value')::bigint, 0),
        coalesce((v_eval->>'progress_percent')::numeric, 0),
        coalesce((v_eval->>'earned')::boolean, false),
        coalesce(v_eval->'metadata', '{}'::jsonb)
          || pg_catalog.jsonb_build_object('metric_source', 'authoritative'),
        false
      );
      v_count := v_count + 1;
    end if;
  end loop;

  select f.founding_number
    into v_founding_number
    from public.founding_authors f
   where f.author_id = p_user_id;

  perform public.novelight_apply_scout_badge_progress(
    p_user_id,
    'limited_founding_author',
    case when v_founding_number is null then 0 else 1 end,
    case
      when v_founding_number is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('founding_number', v_founding_number)
    end
  );

  select b.qualified_at
    into v_beta_qualified_at
    from public.beta_participants b
   where b.auth_user_id = p_user_id;

  perform public.novelight_apply_scout_badge_progress(
    p_user_id,
    'limited_beta_participant',
    case when v_beta_qualified_at is null then 0 else 1 end,
    case
      when v_beta_qualified_at is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('qualified_at', v_beta_qualified_at)
    end
  );

  return v_count + 2;
end
$$;

revoke all on function public.novelight_refresh_scout_badges_for_user(uuid, boolean)
  from public, anon, authenticated;

create or replace function public.novelight_refresh_my_scout_badges()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return public.novelight_refresh_scout_badges_for_user(v_uid, true);
end
$$;

revoke all on function public.novelight_refresh_my_scout_badges()
  from public, anon;
grant execute on function public.novelight_refresh_my_scout_badges()
  to authenticated;

create or replace function public.novelight_refresh_reader_badges_from_scout_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null
     and new.event_type in (
       'valid_read',
       'star_rating_set',
       'comment_posted',
       'comment_deleted',
       'light_seed_sent',
       'light_seed_discovery'
     ) then
    perform public.novelight_refresh_scout_badges_for_user(new.user_id, true);
  end if;
  return new;
end
$$;

revoke all on function public.novelight_refresh_reader_badges_from_scout_event()
  from public, anon, authenticated;

drop trigger if exists scout_event_refresh_reader_badges on public.scout_event_ledger;
create trigger scout_event_refresh_reader_badges
after insert on public.scout_event_ledger
for each row execute function public.novelight_refresh_reader_badges_from_scout_event();

create or replace function public.novelight_refresh_reader_badges_from_discovery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reader_id is not null then
    perform public.novelight_refresh_scout_badges_for_user(new.reader_id, true);
  end if;
  return new;
end
$$;

revoke all on function public.novelight_refresh_reader_badges_from_discovery()
  from public, anon, authenticated;

drop trigger if exists scout_discovery_refresh_reader_badges on public.seed_discovery_state;
create trigger scout_discovery_refresh_reader_badges
after insert or update of best_rank_delta, highest_rank_seen on public.seed_discovery_state
for each row execute function public.novelight_refresh_reader_badges_from_discovery();

create or replace function public.novelight_refresh_reader_badges_from_xp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    perform public.novelight_refresh_scout_badges_for_user(new.user_id, true);
  end if;
  return new;
end
$$;

revoke all on function public.novelight_refresh_reader_badges_from_xp()
  from public, anon, authenticated;

drop trigger if exists scout_xp_refresh_reader_badges on public.scout_xp_ledger;
create trigger scout_xp_refresh_reader_badges
after insert on public.scout_xp_ledger
for each row execute function public.novelight_refresh_reader_badges_from_xp();

create or replace function public.novelight_refresh_reader_badges_from_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Badge reward inserts are handled by the enclosing badge refresh second pass.
  if new.user_id is not null
     and new.point_kind <> 'badge' then
    perform public.novelight_refresh_scout_badges_for_user(new.user_id, true);
  end if;
  return new;
end
$$;

revoke all on function public.novelight_refresh_reader_badges_from_point()
  from public, anon, authenticated;

drop trigger if exists scout_point_refresh_reader_badges on public.scout_point_ledger;
create trigger scout_point_refresh_reader_badges
after insert or update of status on public.scout_point_ledger
for each row execute function public.novelight_refresh_reader_badges_from_point();

create or replace function public.novelight_refresh_reader_badges_from_comment_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null
     and (
       tg_op = 'INSERT'
       or old.deleted_at is distinct from new.deleted_at
       or old.author_hidden_at is distinct from new.author_hidden_at
     ) then
    perform public.novelight_refresh_scout_badges_for_user(new.user_id, true);
  end if;
  return new;
end
$$;

revoke all on function public.novelight_refresh_reader_badges_from_comment_state()
  from public, anon, authenticated;

drop trigger if exists scout_comment_refresh_reader_badges on public.novel_comments;
create trigger scout_comment_refresh_reader_badges
after insert or update of deleted_at, author_hidden_at on public.novel_comments
for each row execute function public.novelight_refresh_reader_badges_from_comment_state();

create or replace function public.novelight_refresh_badges_from_metric_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $badge_metric$
begin
  if new.user_id is not null then
    perform public.novelight_refresh_scout_badges_for_user(new.user_id, true);
  end if;
  return new;
end
$badge_metric$;

revoke all on function public.novelight_refresh_badges_from_metric_state()
  from public, anon, authenticated;

drop trigger if exists scout_metric_state_refresh_badges on public.scout_badge_metric_state;
create trigger scout_metric_state_refresh_badges
after insert or update of metric_value on public.scout_badge_metric_state
for each row execute function public.novelight_refresh_badges_from_metric_state();

-- Baseline current progress and earned badges from authoritative existing data,
-- but deliberately do NOT issue historical Reader Badge Scout Point.
do $$
declare
  v_user record;
begin
  for v_user in
    select p.id from public.profiles p order by p.id
  loop
    perform public.novelight_refresh_scout_badges_for_user(v_user.id, false);
  end loop;
end
$$;

comment on table public.scout_badge_definitions is
  'Data-driven Badge System definitions. Canonical beta catalog: Reader 100, Author 40, Limited/Special separate.';
comment on function public.novelight_reader_badge_metrics(uuid) is
  'Authoritative Reader Badge metric snapshot. Thresholds come from scout_badge_runtime_config.badge_settings.';
comment on function public.novelight_refresh_scout_badges_for_user(uuid, boolean) is
  'Shared Metric -> Condition -> Progress -> Unlock -> Reader reward engine. false suppresses retroactive Point backfill.';

commit;