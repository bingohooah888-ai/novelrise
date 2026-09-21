-- NOVELIGHT Badge System beta completion.
-- Adds the accepted Reader Badge 100 definitions, canonical Author Badge IDs,
-- a shared metric/condition/progress/reward engine, and event-driven refresh.
-- Historical progress/badges are reconstructed without retroactive Scout Point.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921070000'));

do $$
declare
  v_author integer;
  v_reader integer;
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.valid_read_events') is null
     or to_regclass('public.novel_star_ratings') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'SCOUT badge and reader activity foundations are required';
  end if;

  select count(*) filter (where badge_category = 'author'),
         count(*) filter (where badge_category = 'reader')
    into v_author, v_reader
    from public.scout_badge_definitions;

  if v_author <> 40 or v_reader <> 0 then
    raise exception 'Badge definitions require reconciliation before completion: author %, reader %',
      v_author, v_reader;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'scout_badge_definitions'
       and column_name in ('metric_key', 'condition_config')
  ) then
    raise exception 'Badge completion schema is already partially installed';
  end if;
end
$$;

alter table public.scout_badge_definitions
  add column metric_key text,
  add column condition_config jsonb not null default '{}'::jsonb;

alter table public.scout_badge_runtime_config
  add column new_author_window_days integer not null default 30
    check (new_author_window_days between 1 and 3650),
  add column new_work_window_days integer not null default 7
    check (new_work_window_days between 1 and 365),
  add column low_rank_threshold smallint not null default 2
    check (low_rank_threshold between 1 and 6),
  add column long_read_min_chars integer not null default 100000
    check (long_read_min_chars > 0),
  add column long_read_min_episodes integer not null default 5
    check (long_read_min_episodes > 0),
  add column short_read_max_chars integer not null default 20000
    check (short_read_max_chars > 0),
  add column completed_read_ratio numeric(5,4) not null default 0.8000
    check (completed_read_ratio > 0 and completed_read_ratio <= 1);

update public.scout_badge_definitions
   set metric_key = condition_type
 where metric_key is null;

-- Move old generic Author rows out of the canonical sort slots while the
-- stable IDs are inserted. User acquisition state is copied below.
update public.scout_badge_definitions
   set sort_order = sort_order + 1000
 where badge_category = 'author';

insert into public.scout_badge_definitions (
  badge_id, badge_category, difficulty, display_name, description,
  metric_key, condition_type, target_value, condition_config,
  point_reward, is_limited, sort_order, metadata
) values
  ('author_novel_001','author','easy','初作品公開','初作品を公開','author_work_published','threshold',1,'{}',0,false,1,'{"spec_no":1}'::jsonb),
  ('author_episode_001','author','easy','初エピソード公開','初エピソードを公開','author_episode_published','threshold',1,'{}',0,false,2,'{"spec_no":2}'::jsonb),
  ('author_reader_001','author','easy','初ユニーク読者','初ユニーク読者を獲得','author_unique_readers','threshold',1,'{}',0,false,3,'{"spec_no":3}'::jsonb),
  ('author_favorite_001','author','easy','初お気に入り','初お気に入りを獲得','author_favorites_received','threshold',1,'{}',0,false,4,'{"spec_no":4}'::jsonb),
  ('author_comment_001','author','easy','初コメント','初有効コメントを獲得','author_comments_received','threshold',1,'{}',0,false,5,'{"spec_no":5}'::jsonb),
  ('author_episode_010','author','normal','累計10話公開','累計10話を公開','author_episode_published','threshold',10,'{}',0,false,6,'{"spec_no":6}'::jsonb),
  ('author_episode_025','author','normal','累計25話公開','累計25話を公開','author_episode_published','threshold',25,'{}',0,false,7,'{"spec_no":7}'::jsonb),
  ('author_episode_050','author','normal','累計50話公開','累計50話を公開','author_episode_published','threshold',50,'{}',0,false,8,'{"spec_no":8}'::jsonb),
  ('author_episode_100','author','normal','累計100話公開','累計100話を公開','author_episode_published','threshold',100,'{}',0,false,9,'{"spec_no":9}'::jsonb),
  ('author_episode_250','author','normal','累計250話公開','累計250話を公開','author_episode_published','threshold',250,'{}',0,false,10,'{"spec_no":10}'::jsonb),
  ('author_chars_010k','author','normal','累計1万字公開','累計公開本文10,000文字','author_words_published','threshold',10000,'{}',0,false,11,'{"spec_no":11}'::jsonb),
  ('author_chars_050k','author','normal','累計5万字公開','累計公開本文50,000文字','author_words_published','threshold',50000,'{}',0,false,12,'{"spec_no":12}'::jsonb),
  ('author_chars_100k','author','normal','累計10万字公開','累計公開本文100,000文字','author_words_published','threshold',100000,'{}',0,false,13,'{"spec_no":13}'::jsonb),
  ('author_chars_250k','author','normal','累計25万字公開','累計公開本文250,000文字','author_words_published','threshold',250000,'{}',0,false,14,'{"spec_no":14}'::jsonb),
  ('author_chars_500k','author','normal','累計50万字公開','累計公開本文500,000文字','author_words_published','threshold',500000,'{}',0,false,15,'{"spec_no":15}'::jsonb),
  ('author_completed_001','author','normal','初作品完結','初作品を完結','author_works_completed','threshold',1,'{}',0,false,16,'{"spec_no":16}'::jsonb),
  ('author_completed_003','author','normal','3作品完結','3作品を完結','author_works_completed','threshold',3,'{}',0,false,17,'{"spec_no":17}'::jsonb),
  ('author_completed_005','author','normal','5作品完結','5作品を完結','author_works_completed','threshold',5,'{}',0,false,18,'{"spec_no":18}'::jsonb),
  ('author_novel_002','author','normal','2作品公開','2作品を公開','author_work_published','threshold',2,'{}',0,false,19,'{"spec_no":19}'::jsonb),
  ('author_novel_005','author','normal','5作品公開','5作品を公開','author_work_published','threshold',5,'{}',0,false,20,'{"spec_no":20}'::jsonb),
  ('author_novel_010','author','normal','10作品公開','10作品を公開','author_work_published','threshold',10,'{}',0,false,21,'{"spec_no":21}'::jsonb),
  ('author_unique_reader_010','author','normal','ユニーク読者10人','累計ユニーク読者10人','author_unique_readers','threshold',10,'{}',0,false,22,'{"spec_no":22}'::jsonb),
  ('author_unique_reader_050','author','normal','ユニーク読者50人','累計ユニーク読者50人','author_unique_readers','threshold',50,'{}',0,false,23,'{"spec_no":23}'::jsonb),
  ('author_unique_reader_100','author','normal','ユニーク読者100人','累計ユニーク読者100人','author_unique_readers','threshold',100,'{}',0,false,24,'{"spec_no":24}'::jsonb),
  ('author_unique_reader_500','author','normal','ユニーク読者500人','累計ユニーク読者500人','author_unique_readers','threshold',500,'{}',0,false,25,'{"spec_no":25}'::jsonb),
  ('author_favorite_010','author','normal','お気に入り10','累計お気に入り10件','author_favorites_received','threshold',10,'{}',0,false,26,'{"spec_no":26}'::jsonb),
  ('author_favorite_050','author','normal','お気に入り50','累計お気に入り50件','author_favorites_received','threshold',50,'{}',0,false,27,'{"spec_no":27}'::jsonb),
  ('author_favorite_100','author','normal','お気に入り100','累計お気に入り100件','author_favorites_received','threshold',100,'{}',0,false,28,'{"spec_no":28}'::jsonb),
  ('author_comment_010','author','normal','有効コメント10','累計有効コメント10件','author_comments_received','threshold',10,'{}',0,false,29,'{"spec_no":29}'::jsonb),
  ('author_comment_050','author','normal','有効コメント50','累計有効コメント50件','author_comments_received','threshold',50,'{}',0,false,30,'{"spec_no":30}'::jsonb),
  ('author_seed_received_001','author','normal','初LIGHT SEED獲得','初LIGHT SEEDを獲得','author_seeds_received','threshold',1,'{}',0,false,31,'{"spec_no":31}'::jsonb),
  ('author_seed_received_010','author','normal','LIGHT SEED 10','累計LIGHT SEED 10','author_seeds_received','threshold',10,'{}',0,false,32,'{"spec_no":32}'::jsonb),
  ('author_seed_received_050','author','normal','LIGHT SEED 50','累計LIGHT SEED 50','author_seeds_received','threshold',50,'{}',0,false,33,'{"spec_no":33}'::jsonb),
  ('author_discovered_plus2_001','author','normal','自作品 +2 Rank','自作品1作品がLIGHT SEED後+2 Rank以上成長','author_seed_growth_plus2_works','threshold',1,'{}',0,false,34,'{"spec_no":34}'::jsonb),
  ('author_discovered_plus3_001','author','normal','自作品 +3 Rank','自作品1作品がLIGHT SEED後+3 Rank以上成長','author_seed_growth_plus3_works','threshold',1,'{}',0,false,35,'{"spec_no":35}'::jsonb),
  ('author_chars_1m','author','hard','累計100万字公開','累計公開本文1,000,000文字','author_words_published','threshold',1000000,'{}',0,false,36,'{"spec_no":36}'::jsonb),
  ('author_completed_010','author','hard','10作品完結','10作品を完結','author_works_completed','threshold',10,'{}',0,false,37,'{"spec_no":37}'::jsonb),
  ('author_unique_reader_1000','author','hard','ユニーク読者1,000人','累計ユニーク読者1,000人','author_unique_readers','threshold',1000,'{}',0,false,38,'{"spec_no":38}'::jsonb),
  ('author_favorite_500','author','hard','お気に入り500','累計お気に入り500件','author_favorites_received','threshold',500,'{}',0,false,39,'{"spec_no":39}'::jsonb),
  ('author_discovered_plus2_005','author','hard','5作品 +2 Rank','自作品5作品がLIGHT SEED後+2 Rank以上成長','author_seed_growth_plus2_works','threshold',5,'{}',0,false,40,'{"spec_no":40}'::jsonb);

with badge_map(old_id, new_id) as (
  values
    ('author_badge_001','author_novel_001'),('author_badge_002','author_episode_001'),
    ('author_badge_003','author_reader_001'),('author_badge_004','author_favorite_001'),
    ('author_badge_005','author_comment_001'),('author_badge_006','author_episode_010'),
    ('author_badge_007','author_episode_025'),('author_badge_008','author_episode_050'),
    ('author_badge_009','author_episode_100'),('author_badge_010','author_episode_250'),
    ('author_badge_011','author_chars_010k'),('author_badge_012','author_chars_050k'),
    ('author_badge_013','author_chars_100k'),('author_badge_014','author_chars_250k'),
    ('author_badge_015','author_chars_500k'),('author_badge_016','author_completed_001'),
    ('author_badge_017','author_completed_003'),('author_badge_018','author_completed_005'),
    ('author_badge_019','author_novel_002'),('author_badge_020','author_novel_005'),
    ('author_badge_021','author_novel_010'),('author_badge_022','author_unique_reader_010'),
    ('author_badge_023','author_unique_reader_050'),('author_badge_024','author_unique_reader_100'),
    ('author_badge_025','author_unique_reader_500'),('author_badge_026','author_favorite_010'),
    ('author_badge_027','author_favorite_050'),('author_badge_028','author_favorite_100'),
    ('author_badge_029','author_comment_010'),('author_badge_030','author_comment_050'),
    ('author_badge_031','author_seed_received_001'),('author_badge_032','author_seed_received_010'),
    ('author_badge_033','author_seed_received_050'),('author_badge_034','author_discovered_plus2_001'),
    ('author_badge_035','author_discovered_plus3_001'),('author_badge_036','author_chars_1m'),
    ('author_badge_037','author_completed_010'),('author_badge_038','author_unique_reader_1000'),
    ('author_badge_039','author_favorite_500'),('author_badge_040','author_discovered_plus2_005')
)
insert into public.user_scout_badges (
  user_id, badge_id, progress_value, progress_percent, earned_at,
  status, is_public, metadata, created_at, updated_at
)
select b.user_id, m.new_id, b.progress_value, b.progress_percent, b.earned_at,
       b.status, b.is_public, b.metadata, b.created_at, b.updated_at
  from public.user_scout_badges b
  join badge_map m on m.old_id = b.badge_id
on conflict (user_id, badge_id) do update
  set progress_value = greatest(public.user_scout_badges.progress_value, excluded.progress_value),
      progress_percent = greatest(public.user_scout_badges.progress_percent, excluded.progress_percent),
      earned_at = coalesce(public.user_scout_badges.earned_at, excluded.earned_at),
      status = case when public.user_scout_badges.status = 'earned' or excluded.status = 'earned'
                    then 'earned' else excluded.status end,
      is_public = public.user_scout_badges.is_public,
      metadata = public.user_scout_badges.metadata || excluded.metadata,
      updated_at = now();

delete from public.user_scout_badges
 where badge_id ~ '^author_badge_[0-9]{3}$';
delete from public.scout_badge_definitions
 where badge_id ~ '^author_badge_[0-9]{3}$';

-- Reader Badge 100 accepted beta definitions.
insert into public.scout_badge_definitions (
  badge_id, badge_category, difficulty, display_name, description,
  metric_key, condition_type, target_value, condition_config,
  point_reward, is_limited, sort_order, metadata
) values
  ('reader_read_001','reader','easy','最初の一冊','有効読書 1作品','valid_read_work_count','threshold',1,'{}',1,false,1,'{"spec_no":1}'::jsonb),
  ('reader_read_005','reader','easy','有効読書 5作品','有効読書 5作品','valid_read_work_count','threshold',5,'{}',1,false,2,'{"spec_no":2}'::jsonb),
  ('reader_read_010','reader','easy','有効読書 10作品','有効読書 10作品','valid_read_work_count','threshold',10,'{}',1,false,3,'{"spec_no":3}'::jsonb),
  ('reader_read_025','reader','easy','有効読書 25作品','有効読書 25作品','valid_read_work_count','threshold',25,'{}',1,false,4,'{"spec_no":4}'::jsonb),
  ('reader_rating_001','reader','easy','☆評価 1作品','有効☆評価 1作品','valid_rating_work_count','threshold',1,'{}',1,false,5,'{"spec_no":5}'::jsonb),
  ('reader_rating_005','reader','easy','☆評価 5作品','有効☆評価 5作品','valid_rating_work_count','threshold',5,'{}',1,false,6,'{"spec_no":6}'::jsonb),
  ('reader_rating_010','reader','easy','☆評価 10作品','有効☆評価 10作品','valid_rating_work_count','threshold',10,'{}',1,false,7,'{"spec_no":7}'::jsonb),
  ('reader_comment_001','reader','easy','コメント 1作品','有効コメント 1作品','valid_comment_work_count','threshold',1,'{}',1,false,8,'{"spec_no":8}'::jsonb),
  ('reader_comment_005','reader','easy','コメント 5作品','有効コメント 5作品','valid_comment_work_count','threshold',5,'{}',1,false,9,'{"spec_no":9}'::jsonb),
  ('reader_comment_010','reader','easy','コメント 10作品','有効コメント 10作品','valid_comment_work_count','threshold',10,'{}',1,false,10,'{"spec_no":10}'::jsonb),
  ('reader_seed_001','reader','easy','LIGHT SEED 1','LIGHT SEED累計 1','light_seed_count','threshold',1,'{}',1,false,11,'{"spec_no":11}'::jsonb),
  ('reader_seed_003','reader','easy','LIGHT SEED 3','LIGHT SEED累計 3','light_seed_count','threshold',3,'{}',1,false,12,'{"spec_no":12}'::jsonb),
  ('reader_seed_005','reader','easy','LIGHT SEED 5','LIGHT SEED累計 5','light_seed_count','threshold',5,'{}',1,false,13,'{"spec_no":13}'::jsonb),
  ('reader_seed_010','reader','easy','LIGHT SEED 10','LIGHT SEED累計 10','light_seed_count','threshold',10,'{}',1,false,14,'{"spec_no":14}'::jsonb),
  ('reader_bronze_seed_001','reader','easy','BRONZE SEED 1','BRONZE SEED 1回','bronze_seed_count','threshold',1,'{}',1,false,15,'{"spec_no":15}'::jsonb),
  ('reader_silver_seed_001','reader','easy','SILVER SEED 1','SILVER SEED 1回','silver_seed_count','threshold',1,'{}',1,false,16,'{"spec_no":16}'::jsonb),
  ('reader_gold_seed_001','reader','easy','GOLD SEED 1','GOLD SEED 1回','gold_seed_count','threshold',1,'{}',1,false,17,'{"spec_no":17}'::jsonb),
  ('reader_discovery_plus2_001','reader','easy','+2 Rank発掘 1','+2 Rank以上発掘成功 1作品','discovery_plus2_work_count','threshold',1,'{}',1,false,18,'{"spec_no":18}'::jsonb),
  ('reader_discovery_plus2_002','reader','easy','+2 Rank発掘 2','+2 Rank以上発掘成功 2作品','discovery_plus2_work_count','threshold',2,'{}',1,false,19,'{"spec_no":19}'::jsonb),
  ('reader_discovery_plus2_003','reader','easy','+2 Rank発掘 3','+2 Rank以上発掘成功 3作品','discovery_plus2_work_count','threshold',3,'{}',1,false,20,'{"spec_no":20}'::jsonb),
  ('reader_new_author_005','reader','easy','新規作者 5人','新規作者作品を5作者分有効読書','new_author_read_count','threshold',5,'{}',1,false,21,'{"spec_no":21}'::jsonb),
  ('reader_new_author_010','reader','easy','新規作者 10人','新規作者作品を10作者分有効読書','new_author_read_count','threshold',10,'{}',1,false,22,'{"spec_no":22}'::jsonb),
  ('reader_genre_003','reader','easy','3ジャンル探索','3ジャンルで有効読書','genre_count','threshold',3,'{}',1,false,23,'{"spec_no":23}'::jsonb),
  ('reader_genre_005','reader','easy','5ジャンル探索','5ジャンルで有効読書','genre_count','threshold',5,'{}',1,false,24,'{"spec_no":24}'::jsonb),
  ('reader_new_work_005','reader','easy','新着 5作品','新着作品を5作品有効読書','new_work_read_count','threshold',5,'{}',1,false,25,'{"spec_no":25}'::jsonb),
  ('reader_low_rank_005','reader','easy','低Rank 5作品','低Rank作品を5作品有効読書','low_rank_read_count','threshold',5,'{}',1,false,26,'{"spec_no":26}'::jsonb),
  ('reader_level_005','reader','easy','Scout Level 5','Scout Level 5到達','scout_level','threshold',5,'{}',1,false,27,'{"spec_no":27}'::jsonb),
  ('reader_level_010','reader','easy','Scout Level 10','Scout Level 10到達','scout_level','threshold',10,'{}',1,false,28,'{"spec_no":28}'::jsonb),
  ('reader_level_020','reader','easy','Scout Level 20','Scout Level 20到達','scout_level','threshold',20,'{}',1,false,29,'{"spec_no":29}'::jsonb),
  ('reader_active_days_007','reader','easy','活動日 7日','有効活動日 7日','active_day_count','threshold',7,'{}',1,false,30,'{"spec_no":30}'::jsonb),
  ('reader_read_050','reader','normal','有効読書 50作品','有効読書 50作品','valid_read_work_count','threshold',50,'{}',5,false,31,'{"spec_no":31}'::jsonb),
  ('reader_read_100','reader','normal','有効読書 100作品','有効読書 100作品','valid_read_work_count','threshold',100,'{}',5,false,32,'{"spec_no":32}'::jsonb),
  ('reader_read_200','reader','normal','有効読書 200作品','有効読書 200作品','valid_read_work_count','threshold',200,'{}',5,false,33,'{"spec_no":33}'::jsonb),
  ('reader_read_300','reader','normal','有効読書 300作品','有効読書 300作品','valid_read_work_count','threshold',300,'{}',5,false,34,'{"spec_no":34}'::jsonb),
  ('reader_rating_025','reader','normal','☆評価 25作品','有効☆評価 25作品','valid_rating_work_count','threshold',25,'{}',5,false,35,'{"spec_no":35}'::jsonb),
  ('reader_rating_050','reader','normal','☆評価 50作品','有効☆評価 50作品','valid_rating_work_count','threshold',50,'{}',5,false,36,'{"spec_no":36}'::jsonb),
  ('reader_rating_100','reader','normal','☆評価 100作品','有効☆評価 100作品','valid_rating_work_count','threshold',100,'{}',5,false,37,'{"spec_no":37}'::jsonb),
  ('reader_comment_025','reader','normal','コメント 25作品','有効コメント 25作品','valid_comment_work_count','threshold',25,'{}',5,false,38,'{"spec_no":38}'::jsonb),
  ('reader_comment_050','reader','normal','コメント 50作品','有効コメント 50作品','valid_comment_work_count','threshold',50,'{}',5,false,39,'{"spec_no":39}'::jsonb),
  ('reader_comment_100','reader','normal','コメント 100作品','有効コメント 100作品','valid_comment_work_count','threshold',100,'{}',5,false,40,'{"spec_no":40}'::jsonb),
  ('reader_seed_025','reader','normal','LIGHT SEED 25','LIGHT SEED累計25','light_seed_count','threshold',25,'{}',5,false,41,'{"spec_no":41}'::jsonb),
  ('reader_seed_050','reader','normal','LIGHT SEED 50','LIGHT SEED累計50','light_seed_count','threshold',50,'{}',5,false,42,'{"spec_no":42}'::jsonb),
  ('reader_seed_100','reader','normal','LIGHT SEED 100','LIGHT SEED累計100','light_seed_count','threshold',100,'{}',5,false,43,'{"spec_no":43}'::jsonb),
  ('reader_gold_seed_005','reader','normal','GOLD SEED 5','GOLD SEED累計5','gold_seed_count','threshold',5,'{}',5,false,44,'{"spec_no":44}'::jsonb),
  ('reader_silver_seed_010','reader','normal','SILVER SEED 10','SILVER SEED累計10','silver_seed_count','threshold',10,'{}',5,false,45,'{"spec_no":45}'::jsonb),
  ('reader_bronze_seed_015','reader','normal','BRONZE SEED 15','BRONZE SEED累計15','bronze_seed_count','threshold',15,'{}',5,false,46,'{"spec_no":46}'::jsonb),
  ('reader_discovery_plus2_005','reader','normal','+2 Rank発掘 5','+2 Rank以上発掘 5作品','discovery_plus2_work_count','threshold',5,'{}',10,false,47,'{"spec_no":47}'::jsonb),
  ('reader_discovery_plus2_010','reader','normal','+2 Rank発掘 10','+2 Rank以上発掘 10作品','discovery_plus2_work_count','threshold',10,'{}',10,false,48,'{"spec_no":48}'::jsonb),
  ('reader_discovery_plus2_020','reader','normal','+2 Rank発掘 20','+2 Rank以上発掘 20作品','discovery_plus2_work_count','threshold',20,'{}',10,false,49,'{"spec_no":49}'::jsonb),
  ('reader_discovery_plus3_001','reader','normal','+3 Rank発掘 1','+3 Rank以上発掘 1作品','discovery_plus3_work_count','threshold',1,'{}',10,false,50,'{"spec_no":50}'::jsonb),
  ('reader_discovery_plus3_005','reader','normal','+3 Rank発掘 5','+3 Rank以上発掘 5作品','discovery_plus3_work_count','threshold',5,'{}',10,false,51,'{"spec_no":51}'::jsonb),
  ('reader_discovery_plus3_010','reader','normal','+3 Rank発掘 10','+3 Rank以上発掘 10作品','discovery_plus3_work_count','threshold',10,'{}',10,false,52,'{"spec_no":52}'::jsonb),
  ('reader_discovery_plus4_001','reader','normal','+4 Rank発掘 1','+4 Rank以上発掘 1作品','discovery_plus4_work_count','threshold',1,'{}',10,false,53,'{"spec_no":53}'::jsonb),
  ('reader_discovery_plus4_002','reader','normal','+4 Rank発掘 2','+4 Rank以上発掘 2作品','discovery_plus4_work_count','threshold',2,'{}',10,false,54,'{"spec_no":54}'::jsonb),
  ('reader_discovery_plus4_005','reader','normal','+4 Rank発掘 5','+4 Rank以上発掘 5作品','discovery_plus4_work_count','threshold',5,'{}',10,false,55,'{"spec_no":55}'::jsonb),
  ('reader_nova_001','reader','normal','NOVA予見 1','NOVA予見 1回','nova_prediction_count','threshold',1,'{}',10,false,56,'{"spec_no":56}'::jsonb),
  ('reader_nova_003','reader','normal','NOVA予見 3','NOVA予見 3回','nova_prediction_count','threshold',3,'{}',10,false,57,'{"spec_no":57}'::jsonb),
  ('reader_nova_005','reader','normal','NOVA予見 5','NOVA予見 5回','nova_prediction_count','threshold',5,'{}',10,false,58,'{"spec_no":58}'::jsonb),
  ('reader_new_author_025','reader','normal','新規作者 25人','新規作者25人の作品を有効読書','new_author_read_count','threshold',25,'{}',5,false,59,'{"spec_no":59}'::jsonb),
  ('reader_new_author_050','reader','normal','新規作者 50人','新規作者50人の作品を有効読書','new_author_read_count','threshold',50,'{}',5,false,60,'{"spec_no":60}'::jsonb),
  ('reader_new_author_100','reader','normal','新規作者 100人','新規作者100人の作品を有効読書','new_author_read_count','threshold',100,'{}',5,false,61,'{"spec_no":61}'::jsonb),
  ('reader_low_rank_025','reader','normal','低Rank 25作品','低Rank作品25作品を有効読書','low_rank_read_count','threshold',25,'{}',5,false,62,'{"spec_no":62}'::jsonb),
  ('reader_low_rank_050','reader','normal','低Rank 50作品','低Rank作品50作品を有効読書','low_rank_read_count','threshold',50,'{}',5,false,63,'{"spec_no":63}'::jsonb),
  ('reader_low_rank_100','reader','normal','低Rank 100作品','低Rank作品100作品を有効読書','low_rank_read_count','threshold',100,'{}',5,false,64,'{"spec_no":64}'::jsonb),
  ('reader_new_work_025','reader','normal','新着 25作品','新着作品25作品を有効読書','new_work_read_count','threshold',25,'{}',5,false,65,'{"spec_no":65}'::jsonb),
  ('reader_new_work_050','reader','normal','新着 50作品','新着作品50作品を有効読書','new_work_read_count','threshold',50,'{}',5,false,66,'{"spec_no":66}'::jsonb),
  ('reader_new_work_100','reader','normal','新着 100作品','新着作品100作品を有効読書','new_work_read_count','threshold',100,'{}',5,false,67,'{"spec_no":67}'::jsonb),
  ('reader_genre_008','reader','normal','8ジャンル探索','8ジャンルで有効読書','genre_count','threshold',8,'{}',5,false,68,'{"spec_no":68}'::jsonb),
  ('reader_genre_010','reader','normal','10ジャンル探索','10ジャンルで有効読書','genre_count','threshold',10,'{}',5,false,69,'{"spec_no":69}'::jsonb),
  ('reader_long_read_005','reader','normal','長編 5作品','長編作品を5作品 qualified_long_read','qualified_long_read_count','threshold',5,'{}',5,false,70,'{"spec_no":70}'::jsonb),
  ('reader_long_read_010','reader','normal','長編 10作品','長編作品を10作品 qualified_long_read','qualified_long_read_count','threshold',10,'{}',5,false,71,'{"spec_no":71}'::jsonb),
  ('reader_short_read_010','reader','normal','短編 10作品読了','短編作品を10作品読了','qualified_short_read_count','threshold',10,'{}',5,false,72,'{"spec_no":72}'::jsonb),
  ('reader_short_read_025','reader','normal','短編 25作品読了','短編作品を25作品読了','qualified_short_read_count','threshold',25,'{}',5,false,73,'{"spec_no":73}'::jsonb),
  ('reader_completed_read_005','reader','normal','完結 5作品読了','完結作品5作品読了','completed_read_count','threshold',5,'{}',5,false,74,'{"spec_no":74}'::jsonb),
  ('reader_completed_read_010','reader','normal','完結 10作品読了','完結作品10作品読了','completed_read_count','threshold',10,'{}',5,false,75,'{"spec_no":75}'::jsonb),
  ('reader_active_days_030','reader','normal','活動日 30日','有効活動日30日','active_day_count','threshold',30,'{}',5,false,76,'{"spec_no":76}'::jsonb),
  ('reader_active_days_090','reader','normal','活動日 90日','有効活動日90日','active_day_count','threshold',90,'{}',5,false,77,'{"spec_no":77}'::jsonb),
  ('reader_level_030','reader','normal','Scout Level 30','Scout Level 30到達','scout_level','threshold',30,'{}',10,false,78,'{"spec_no":78}'::jsonb),
  ('reader_point_100','reader','normal','Scout Point 100','累計Scout Point獲得量100pt','scout_point_earned_count','threshold',100,'{}',0,false,79,'{"spec_no":79,"self_reward_guard":true}'::jsonb),
  ('reader_point_500','reader','normal','Scout Point 500','累計Scout Point獲得量500pt','scout_point_earned_count','threshold',500,'{}',0,false,80,'{"spec_no":80,"self_reward_guard":true}'::jsonb),
  ('reader_read_500','reader','hard','有効読書 500作品','有効読書500作品','valid_read_work_count','threshold',500,'{}',25,false,81,'{"spec_no":81}'::jsonb),
  ('reader_read_1000','reader','hard','有効読書 1,000作品','有効読書1,000作品','valid_read_work_count','threshold',1000,'{}',25,false,82,'{"spec_no":82}'::jsonb),
  ('reader_new_author_250','reader','hard','新規作者 250人','新規作者250人の作品を有効読書','new_author_read_count','threshold',250,'{}',25,false,83,'{"spec_no":83}'::jsonb),
  ('reader_low_rank_250','reader','hard','低Rank 250作品','低Rank作品250作品を有効読書','low_rank_read_count','threshold',250,'{}',25,false,84,'{"spec_no":84}'::jsonb),
  ('reader_low_rank_500','reader','hard','低Rank 500作品','低Rank作品500作品を有効読書','low_rank_read_count','threshold',500,'{}',25,false,85,'{"spec_no":85}'::jsonb),
  ('reader_discovery_plus2_050','reader','hard','+2 Rank発掘 50','+2 Rank以上発掘50作品','discovery_plus2_work_count','threshold',50,'{}',25,false,86,'{"spec_no":86}'::jsonb),
  ('reader_discovery_plus2_100','reader','hard','+2 Rank発掘 100','+2 Rank以上発掘100作品','discovery_plus2_work_count','threshold',100,'{}',25,false,87,'{"spec_no":87}'::jsonb),
  ('reader_discovery_plus3_025','reader','hard','+3 Rank発掘 25','+3 Rank以上発掘25作品','discovery_plus3_work_count','threshold',25,'{}',25,false,88,'{"spec_no":88}'::jsonb),
  ('reader_discovery_plus3_050','reader','hard','+3 Rank発掘 50','+3 Rank以上発掘50作品','discovery_plus3_work_count','threshold',50,'{}',25,false,89,'{"spec_no":89}'::jsonb),
  ('reader_discovery_plus4_010','reader','hard','+4 Rank発掘 10','+4 Rank以上発掘10作品','discovery_plus4_work_count','threshold',10,'{}',25,false,90,'{"spec_no":90}'::jsonb),
  ('reader_discovery_plus4_020','reader','hard','+4 Rank発掘 20','+4 Rank以上発掘20作品','discovery_plus4_work_count','threshold',20,'{}',25,false,91,'{"spec_no":91}'::jsonb),
  ('reader_discovery_plus5_001','reader','hard','+5 Rank発掘 1','+5 Rank発掘1作品','discovery_plus5_work_count','threshold',1,'{}',25,false,92,'{"spec_no":92}'::jsonb),
  ('reader_discovery_plus5_003','reader','hard','+5 Rank発掘 3','+5 Rank発掘3作品','discovery_plus5_work_count','threshold',3,'{}',25,false,93,'{"spec_no":93}'::jsonb),
  ('reader_discovery_plus5_010','reader','hard','+5 Rank発掘 10','+5 Rank発掘10作品','discovery_plus5_work_count','threshold',10,'{}',25,false,94,'{"spec_no":94}'::jsonb),
  ('reader_nova_010','reader','hard','NOVA予見 10','NOVA予見10回','nova_prediction_count','threshold',10,'{}',25,false,95,'{"spec_no":95}'::jsonb),
  ('reader_nova_025','reader','hard','NOVA予見 25','NOVA予見25回','nova_prediction_count','threshold',25,'{}',25,false,96,'{"spec_no":96}'::jsonb),
  ('reader_gold_plus5_001','reader','hard','GOLD +5 Rank','GOLD SEEDから+5 Rank発掘を1回成立','gold_plus5_count','threshold',1,'{}',25,false,97,'{"spec_no":97}'::jsonb),
  ('reader_silver_plus5_001','reader','hard','SILVER +5 Rank','SILVER SEEDから+5 Rank発掘を1回成立','silver_plus5_count','threshold',1,'{}',25,false,98,'{"spec_no":98}'::jsonb),
  ('reader_bronze_plus5_001','reader','hard','BRONZE +5 Rank','BRONZE SEEDから+5 Rank発掘を1回成立','bronze_plus5_count','threshold',1,'{}',25,false,99,'{"spec_no":99}'::jsonb),
  ('reader_master_scout','reader','hard','MASTER SCOUT','+5 Rank発掘10・NOVA予見10・新規作者100・10ジャンルをすべて達成',
   'reader_master_scout','composite_all',4,
   '{"components":[{"metric_key":"discovery_plus5_work_count","target":10,"label":"+5 Rank発掘"},{"metric_key":"nova_prediction_count","target":10,"label":"NOVA予見"},{"metric_key":"new_author_read_count","target":100,"label":"新規作者"},{"metric_key":"genre_count","target":10,"label":"ジャンル"}]}'::jsonb,
   25,false,100,'{"spec_no":100}'::jsonb);

update public.scout_badge_definitions
   set metric_key = condition_type
 where badge_category = 'limited'
   and metric_key is null;

alter table public.scout_badge_definitions
  alter column metric_key set not null;

create or replace function public.novelight_scout_badge_metric_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with cfg as (
  select *
    from public.scout_badge_runtime_config
   where id = 1
),
read_work as (
  select
    v.novel_id_snapshot,
    (array_agg(v.author_id_snapshot order by v.qualified_at, v.id))[1] as author_id,
    min(v.qualified_at) as first_read_at
  from public.valid_read_events v
  where v.reader_id = p_user_id
  group by v.novel_id_snapshot
),
read_detail as (
  select
    rw.novel_id_snapshot,
    rw.author_id,
    rw.first_read_at,
    n.genre,
    n.first_published_at,
    coalesce(rs.is_completed, false) as is_completed,
    coalesce((
      select count(*)::integer
      from public.episodes e
      where e.novel_id::text = rw.novel_id_snapshot
        and e.status = 'published'
    ), 0) as published_episode_count,
    coalesce((
      select sum(pg_catalog.char_length(coalesce(e.content, '')))::bigint
      from public.episodes e
      where e.novel_id::text = rw.novel_id_snapshot
        and e.status = 'published'
    ), 0) as published_chars,
    coalesce((
      select count(*)::integer
      from public.valid_read_events vr
      join public.episodes e on e.id::text = vr.episode_id_snapshot
      where vr.reader_id = p_user_id
        and vr.novel_id_snapshot = rw.novel_id_snapshot
        and e.status = 'published'
    ), 0) as read_episode_count,
    (
      select e.id::text
      from public.episodes e
      where e.novel_id::text = rw.novel_id_snapshot
        and e.status = 'published'
      order by e.episode_number desc, e.id desc
      limit 1
    ) as final_episode_id,
    coalesce((
      select re.to_rank
      from public.novel_rank_events re
      where re.novel_id_snapshot = rw.novel_id_snapshot
        and re.occurred_at <= rw.first_read_at
      order by re.occurred_at desc, re.id desc
      limit 1
    ), rs.current_rank, 1)::smallint as rank_at_read,
    coalesce((
      select min(re.occurred_at)
      from public.novel_rank_events re
      where re.author_id_snapshot = rw.author_id
        and re.event_type = 'initial'
    ), (
      select min(n2.first_published_at)
      from public.novels n2
      where n2.user_id = rw.author_id
        and n2.first_published_at is not null
    )) as author_first_published_at
  from read_work rw
  left join public.novels n on n.id::text = rw.novel_id_snapshot
  left join public.novel_rank_state rs on rs.novel_id_snapshot = rw.novel_id_snapshot
),
activity_days as (
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
     and c.user_id <> n.user_id
     and c.deleted_at is null
     and c.author_hidden_at is null
  union
  select pg_catalog.timezone('Asia/Tokyo', s.seeded_at)::date
    from public.light_seeds s
   where s.reader_id = p_user_id
),
reader_metrics as (
  select
    (select count(*)::bigint from read_work) as valid_read_work_count,
    (select count(*)::bigint from public.novel_star_ratings r where r.user_id = p_user_id) as valid_rating_work_count,
    (select count(distinct c.novel_id)::bigint
       from public.novel_comments c
       join public.novels n on n.id = c.novel_id
      where c.user_id = p_user_id
        and c.user_id <> n.user_id
        and c.deleted_at is null
        and c.author_hidden_at is null) as valid_comment_work_count,
    (select count(*)::bigint from public.light_seeds s where s.reader_id = p_user_id) as light_seed_count,
    (select count(*)::bigint from public.light_seeds s where s.reader_id = p_user_id and s.seed_type = 'BRONZE') as bronze_seed_count,
    (select count(*)::bigint from public.light_seeds s where s.reader_id = p_user_id and s.seed_type = 'SILVER') as silver_seed_count,
    (select count(*)::bigint from public.light_seeds s where s.reader_id = p_user_id and s.seed_type = 'GOLD') as gold_seed_count,
    (select count(distinct d.novel_id_snapshot)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.best_rank_delta >= 2) as discovery_plus2_work_count,
    (select count(distinct d.novel_id_snapshot)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.best_rank_delta >= 3) as discovery_plus3_work_count,
    (select count(distinct d.novel_id_snapshot)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.best_rank_delta >= 4) as discovery_plus4_work_count,
    (select count(distinct d.novel_id_snapshot)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.best_rank_delta >= 5) as discovery_plus5_work_count,
    (select count(*)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.rank_at_seed = 5 and d.highest_rank_seen = 6) as nova_prediction_count,
    (select count(distinct rd.author_id)::bigint
       from read_detail rd, cfg
      where rd.author_id is not null
        and rd.author_first_published_at is not null
        and rd.first_read_at >= rd.author_first_published_at
        and rd.first_read_at <= rd.author_first_published_at + pg_catalog.make_interval(days => cfg.new_author_window_days)) as new_author_read_count,
    (select count(distinct rd.genre)::bigint from read_detail rd where nullif(pg_catalog.btrim(coalesce(rd.genre, '')), '') is not null) as genre_count,
    (select count(*)::bigint
       from read_detail rd, cfg
      where rd.first_published_at is not null
        and rd.first_read_at >= rd.first_published_at
        and rd.first_read_at <= rd.first_published_at + pg_catalog.make_interval(days => cfg.new_work_window_days)) as new_work_read_count,
    (select count(*)::bigint from read_detail rd, cfg where rd.rank_at_read <= cfg.low_rank_threshold) as low_rank_read_count,
    (select public.novelight_scout_level_for_xp(coalesce(sum(x.xp_value), 0)::bigint)::bigint
       from public.scout_xp_ledger x where x.user_id = p_user_id) as scout_level,
    (select count(*)::bigint from activity_days) as active_day_count,
    (select count(*)::bigint
       from read_detail rd, cfg
      where rd.published_chars >= cfg.long_read_min_chars
        and rd.read_episode_count >= cfg.long_read_min_episodes) as qualified_long_read_count,
    (select count(*)::bigint
       from read_detail rd, cfg
      where rd.is_completed
        and rd.published_chars <= cfg.short_read_max_chars
        and rd.published_episode_count > 0
        and rd.final_episode_id is not null
        and exists (
          select 1 from public.valid_read_events vr
           where vr.reader_id = p_user_id
             and vr.episode_id_snapshot = rd.final_episode_id
        )
        and rd.read_episode_count >= pg_catalog.ceil(rd.published_episode_count * cfg.completed_read_ratio)::integer) as qualified_short_read_count,
    (select count(*)::bigint
       from read_detail rd, cfg
      where rd.is_completed
        and rd.published_episode_count > 0
        and rd.final_episode_id is not null
        and exists (
          select 1 from public.valid_read_events vr
           where vr.reader_id = p_user_id
             and vr.episode_id_snapshot = rd.final_episode_id
        )
        and rd.read_episode_count >= pg_catalog.ceil(rd.published_episode_count * cfg.completed_read_ratio)::integer) as completed_read_count,
    greatest(0, (select coalesce(sum(p.point_value), 0)::bigint
                   from public.scout_point_ledger p
                  where p.user_id = p_user_id
                    and p.status = 'confirmed')) as scout_point_earned_count,
    (select count(*)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.seed_type = 'GOLD' and d.best_rank_delta >= 5) as gold_plus5_count,
    (select count(*)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.seed_type = 'SILVER' and d.best_rank_delta >= 5) as silver_plus5_count,
    (select count(*)::bigint from public.seed_discovery_state d where d.reader_id = p_user_id and d.seed_type = 'BRONZE' and d.best_rank_delta >= 5) as bronze_plus5_count
),
author_metrics as (
  select
    (select count(*)::bigint from public.novels n where n.user_id = p_user_id and n.status = 'published' and n.first_published_at is not null) as author_work_published,
    (select count(*)::bigint from public.episodes e join public.novels n on n.id = e.novel_id where n.user_id = p_user_id and e.status = 'published') as author_episode_published,
    (select count(distinct v.reader_id)::bigint from public.valid_read_events v join public.novels n on n.id::text = v.novel_id_snapshot where n.user_id = p_user_id and v.reader_id <> p_user_id) as author_unique_readers,
    (select count(*)::bigint from public.favorites f join public.novels n on n.id = f.novel_id where n.user_id = p_user_id and f.user_id <> p_user_id) as author_favorites_received,
    (select count(*)::bigint from public.novel_comments c join public.novels n on n.id = c.novel_id where n.user_id = p_user_id and c.user_id <> p_user_id and c.deleted_at is null and c.author_hidden_at is null) as author_comments_received,
    (select coalesce(sum(pg_catalog.char_length(coalesce(e.content, ''))), 0)::bigint from public.episodes e join public.novels n on n.id = e.novel_id where n.user_id = p_user_id and e.status = 'published') as author_words_published,
    (select count(*)::bigint from public.novel_rank_state rs join public.novels n on n.id::text = rs.novel_id_snapshot where n.user_id = p_user_id and rs.is_completed) as author_works_completed,
    (select count(*)::bigint from public.light_seeds s join public.novels n on n.id::text = s.novel_id_snapshot where n.user_id = p_user_id) as author_seeds_received,
    (select count(distinct d.novel_id_snapshot)::bigint from public.seed_discovery_state d join public.novels n on n.id::text = d.novel_id_snapshot where n.user_id = p_user_id and d.best_rank_delta >= 2) as author_seed_growth_plus2_works,
    (select count(distinct d.novel_id_snapshot)::bigint from public.seed_discovery_state d join public.novels n on n.id::text = d.novel_id_snapshot where n.user_id = p_user_id and d.best_rank_delta >= 3) as author_seed_growth_plus3_works
)
select
  pg_catalog.jsonb_build_object(
    'valid_read_work_count', r.valid_read_work_count,
    'valid_rating_work_count', r.valid_rating_work_count,
    'valid_comment_work_count', r.valid_comment_work_count,
    'light_seed_count', r.light_seed_count,
    'bronze_seed_count', r.bronze_seed_count,
    'silver_seed_count', r.silver_seed_count,
    'gold_seed_count', r.gold_seed_count,
    'discovery_plus2_work_count', r.discovery_plus2_work_count,
    'discovery_plus3_work_count', r.discovery_plus3_work_count,
    'discovery_plus4_work_count', r.discovery_plus4_work_count,
    'discovery_plus5_work_count', r.discovery_plus5_work_count,
    'nova_prediction_count', r.nova_prediction_count,
    'new_author_read_count', r.new_author_read_count,
    'genre_count', r.genre_count,
    'new_work_read_count', r.new_work_read_count,
    'low_rank_read_count', r.low_rank_read_count,
    'scout_level', r.scout_level,
    'active_day_count', r.active_day_count
  )
  || pg_catalog.jsonb_build_object(
    'qualified_long_read_count', r.qualified_long_read_count,
    'qualified_short_read_count', r.qualified_short_read_count,
    'completed_read_count', r.completed_read_count,
    'scout_point_earned_count', r.scout_point_earned_count,
    'gold_plus5_count', r.gold_plus5_count,
    'silver_plus5_count', r.silver_plus5_count,
    'bronze_plus5_count', r.bronze_plus5_count,
    'author_work_published', a.author_work_published,
    'author_episode_published', a.author_episode_published,
    'author_unique_readers', a.author_unique_readers,
    'author_favorites_received', a.author_favorites_received,
    'author_comments_received', a.author_comments_received,
    'author_words_published', a.author_words_published,
    'author_works_completed', a.author_works_completed,
    'author_seeds_received', a.author_seeds_received,
    'author_seed_growth_plus2_works', a.author_seed_growth_plus2_works,
    'author_seed_growth_plus3_works', a.author_seed_growth_plus3_works
  )
from reader_metrics r
cross join author_metrics a
$$;

revoke all on function public.novelight_scout_badge_metric_snapshot(uuid)
  from public, anon, authenticated;

create or replace function public.novelight_rebuild_scout_badge_metrics(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_key text;
  v_value text;
  v_count integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  v_snapshot := public.novelight_scout_badge_metric_snapshot(p_user_id);

  for v_key, v_value in
    select key, value
      from pg_catalog.jsonb_each_text(v_snapshot)
  loop
    insert into public.scout_badge_metric_state (
      user_id, metric_type, metric_value, metadata, updated_at
    ) values (
      p_user_id, v_key, greatest(coalesce(v_value, '0')::bigint, 0),
      '{"source":"source_of_truth_snapshot"}'::jsonb, now()
    )
    on conflict (user_id, metric_type) do update
      set metric_value = excluded.metric_value,
          metadata = excluded.metadata,
          updated_at = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end
$$;

revoke all on function public.novelight_rebuild_scout_badge_metrics(uuid)
  from public, anon, authenticated;

create or replace function public.novelight_apply_scout_badge_evaluation(
  p_user_id uuid,
  p_badge_id text,
  p_progress_value bigint,
  p_progress_percent numeric,
  p_is_earned boolean,
  p_metadata jsonb default '{}'::jsonb,
  p_award_points boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition public.scout_badge_definitions%rowtype;
  v_existing public.user_scout_badges%rowtype;
  v_progress bigint := greatest(coalesce(p_progress_value, 0), 0);
  v_percent numeric(5,2) := least(100::numeric, greatest(0::numeric, coalesce(p_progress_percent, 0)));
  v_earned boolean := coalesce(p_is_earned, false);
  v_newly_earned boolean := false;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_user_id is null or p_badge_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:badge:' || p_user_id::text || ':' || p_badge_id, 0)
  );

  select * into v_definition
    from public.scout_badge_definitions d
   where d.badge_id = p_badge_id
     and d.enabled;

  if not found then
    return;
  end if;

  select * into v_existing
    from public.user_scout_badges b
   where b.user_id = p_user_id
     and b.badge_id = p_badge_id
   for update;

  if found and v_existing.status = 'revoked' then
    return;
  end if;

  if v_existing.user_id is not null and v_existing.status = 'earned' then
    v_earned := true;
    v_progress := greatest(v_progress, v_existing.progress_value, v_definition.target_value);
    v_percent := 100;
  end if;

  v_newly_earned := v_earned
    and coalesce(v_existing.status <> 'earned', true);

  if v_newly_earned
     and not p_award_points
     and v_definition.badge_category = 'reader'
     and v_definition.point_reward > 0 then
    v_metadata := v_metadata || pg_catalog.jsonb_build_object(
      'point_reward_suppressed', true,
      'point_reward_policy', 'no_retroactive_award'
    );
  end if;

  insert into public.user_scout_badges (
    user_id, badge_id, progress_value, progress_percent, earned_at,
    status, is_public, metadata, updated_at
  ) values (
    p_user_id, p_badge_id, v_progress, v_percent,
    case when v_earned then now() else null end,
    case when v_earned then 'earned' else 'in_progress' end,
    true, v_metadata, now()
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
     and p_award_points
     and v_definition.badge_category = 'reader'
     and v_definition.point_reward > 0 then
    insert into public.scout_point_ledger (
      user_id, point_kind, point_value, status, event_key, occurred_at, metadata
    ) values (
      p_user_id, 'badge', v_definition.point_reward, 'confirmed',
      'badge:' || p_user_id::text || ':' || p_badge_id,
      now(),
      pg_catalog.jsonb_build_object(
        'badge_id', p_badge_id,
        'reason_type', 'badge_reward',
        'reason_id', p_badge_id,
        'display_name', v_definition.display_name,
        'rule_version', 'badge-system-beta-v1'
      )
    )
    on conflict (event_key) do nothing;
  end if;
end
$$;

revoke all on function public.novelight_apply_scout_badge_evaluation(
  uuid, text, bigint, numeric, boolean, jsonb, boolean
) from public, anon, authenticated;

create or replace function public.novelight_evaluate_scout_badges(
  p_user_id uuid,
  p_award_points boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition record;
  v_progress bigint;
  v_percent numeric;
  v_met integer;
  v_total integer;
  v_components jsonb;
  v_count integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  perform public.novelight_rebuild_scout_badge_metrics(p_user_id);

  for v_definition in
    select d.*
      from public.scout_badge_definitions d
     where d.enabled
       and d.badge_category in ('reader', 'author')
     order by d.badge_category, d.sort_order
  loop
    if v_definition.condition_type in ('counter', 'threshold', 'boolean') then
      select coalesce(s.metric_value, 0)::bigint
        into v_progress
        from public.scout_badge_metric_state s
       where s.user_id = p_user_id
         and s.metric_type = v_definition.metric_key;

      v_progress := coalesce(v_progress, 0);
      v_percent := least(
        100::numeric,
        round((v_progress::numeric / v_definition.target_value::numeric) * 100, 2)
      );

      perform public.novelight_apply_scout_badge_evaluation(
        p_user_id, v_definition.badge_id, v_progress, v_percent,
        v_progress >= v_definition.target_value,
        pg_catalog.jsonb_build_object('metric_key', v_definition.metric_key),
        p_award_points
      );

    elsif v_definition.condition_type = 'composite_all' then
      select
        count(*)::integer,
        count(*) filter (
          where coalesce(s.metric_value, 0) >= (c.value->>'target')::bigint
        )::integer,
        coalesce(round(avg(
          least(
            100::numeric,
            (coalesce(s.metric_value, 0)::numeric
              / greatest((c.value->>'target')::bigint, 1)::numeric) * 100
          )
        ), 2), 0),
        coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'metric_key', c.value->>'metric_key',
            'label', coalesce(c.value->>'label', c.value->>'metric_key'),
            'current', coalesce(s.metric_value, 0),
            'target', (c.value->>'target')::bigint,
            'percent', least(
              100::numeric,
              round(
                (coalesce(s.metric_value, 0)::numeric
                  / greatest((c.value->>'target')::bigint, 1)::numeric) * 100,
                2
              )
            )
          )
          order by c.ordinality
        ), '[]'::jsonb)
      into v_total, v_met, v_percent, v_components
      from pg_catalog.jsonb_array_elements(
        coalesce(v_definition.condition_config->'components', '[]'::jsonb)
      ) with ordinality as c(value, ordinality)
      left join public.scout_badge_metric_state s
        on s.user_id = p_user_id
       and s.metric_type = c.value->>'metric_key';

      perform public.novelight_apply_scout_badge_evaluation(
        p_user_id, v_definition.badge_id, coalesce(v_met, 0), v_percent,
        v_total > 0 and v_met = v_total,
        pg_catalog.jsonb_build_object('components', v_components),
        p_award_points
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$$;

revoke all on function public.novelight_evaluate_scout_badges(uuid, boolean)
  from public, anon, authenticated;

create or replace function public.novelight_refresh_scout_badges_for_user(
  p_user_id uuid,
  p_award_points boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_founding_number bigint;
  v_beta boolean;
begin
  if p_user_id is null then
    return 0;
  end if;

  v_count := public.novelight_evaluate_scout_badges(p_user_id, p_award_points);

  select f.founding_number
    into v_founding_number
    from public.founding_authors f
   where f.author_id = p_user_id;

  perform public.novelight_apply_scout_badge_evaluation(
    p_user_id, 'limited_founding_author',
    case when v_founding_number is null then 0 else 1 end,
    case when v_founding_number is null then 0 else 100 end,
    v_founding_number is not null,
    case when v_founding_number is null then '{}'::jsonb
         else pg_catalog.jsonb_build_object('founding_number', v_founding_number) end,
    false
  );

  select exists (
    select 1 from public.beta_participants b where b.auth_user_id = p_user_id
  ) into v_beta;

  perform public.novelight_apply_scout_badge_evaluation(
    p_user_id, 'limited_beta_participant',
    case when v_beta then 1 else 0 end,
    case when v_beta then 100 else 0 end,
    v_beta, '{}'::jsonb, false
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

  -- Owner refresh reconstructs progress only. It never turns historical
  -- activity into retroactive Scout Point.
  return public.novelight_refresh_scout_badges_for_user(v_uid, false);
end
$$;

revoke all on function public.novelight_refresh_my_scout_badges()
  from public, anon;
grant execute on function public.novelight_refresh_my_scout_badges()
  to authenticated;

-- Generic source refresh helpers. The badge engine remains definition-driven;
-- triggers only identify the affected account(s).
create or replace function public.novelight_refresh_badges_from_novel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.novelight_refresh_scout_badges_for_user(v_uid, true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_episode()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.novelight_refresh_scout_badges_for_user(v_uid, true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_favorite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_novel_id bigint; v_author uuid;
begin
  v_novel_id := case when tg_op = 'DELETE' then old.novel_id else new.novel_id end;
  select n.user_id into v_author from public.novels n where n.id = v_novel_id;
  if v_author is not null then
    perform public.novelight_refresh_scout_badges_for_user(v_author, true);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reader uuid; v_novel_id bigint; v_author uuid;
begin
  if tg_op = 'DELETE' then
    v_reader := old.user_id; v_novel_id := old.novel_id;
  else
    v_reader := new.user_id; v_novel_id := new.novel_id;
  end if;
  select n.user_id into v_author from public.novels n where n.id = v_novel_id;
  perform public.novelight_refresh_scout_badges_for_user(v_reader, true);
  if v_author is not null and v_author <> v_reader then
    perform public.novelight_refresh_scout_badges_for_user(v_author, true);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_valid_read()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.novelight_refresh_scout_badges_for_user(new.reader_id, true);
  if new.author_id_snapshot is not null and new.author_id_snapshot <> new.reader_id then
    perform public.novelight_refresh_scout_badges_for_user(new.author_id_snapshot, true);
  end if;
  return new;
end $$;

create or replace function public.novelight_refresh_badges_from_seed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.novelight_refresh_scout_badges_for_user(new.reader_id, true);
  if new.author_id_snapshot is not null and new.author_id_snapshot <> new.reader_id then
    perform public.novelight_refresh_scout_badges_for_user(new.author_id_snapshot, true);
  end if;
  return new;
end $$;

create or replace function public.novelight_refresh_badges_from_discovery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reader uuid; v_author uuid; v_seed uuid;
begin
  v_reader := case when tg_op = 'DELETE' then old.reader_id else new.reader_id end;
  v_seed := case when tg_op = 'DELETE' then old.seed_id else new.seed_id end;
  select s.author_id_snapshot into v_author from public.light_seeds s where s.id = v_seed;
  perform public.novelight_refresh_scout_badges_for_user(v_reader, true);
  if v_author is not null and v_author <> v_reader then
    perform public.novelight_refresh_scout_badges_for_user(v_author, true);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.novelight_refresh_scout_badges_for_user(v_uid, true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_xp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.novelight_refresh_scout_badges_for_user(new.user_id, true);
  return new;
end $$;

create or replace function public.novelight_refresh_badges_from_point()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.novelight_refresh_scout_badges_for_user(v_uid, true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.novelight_refresh_badges_from_rank_state()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := case when tg_op = 'DELETE' then old.author_id_snapshot else new.author_id_snapshot end;
  perform public.novelight_refresh_scout_badges_for_user(v_uid, true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.novelight_refresh_badges_from_novel() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_episode() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_favorite() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_comment() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_valid_read() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_seed() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_discovery() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_rating() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_xp() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_point() from public, anon, authenticated;
revoke all on function public.novelight_refresh_badges_from_rank_state() from public, anon, authenticated;

create trigger scout_badge_refresh_novel
after insert or update of status, first_published_at or delete on public.novels
for each row execute function public.novelight_refresh_badges_from_novel();

create trigger scout_badge_refresh_episode
after insert or update of status, content or delete on public.episodes
for each row execute function public.novelight_refresh_badges_from_episode();

create trigger scout_badge_refresh_favorite
after insert or delete on public.favorites
for each row execute function public.novelight_refresh_badges_from_favorite();

create trigger scout_badge_refresh_comment
after insert or update of deleted_at, author_hidden_at or delete on public.novel_comments
for each row execute function public.novelight_refresh_badges_from_comment();

create trigger scout_badge_refresh_valid_read
after insert on public.valid_read_events
for each row execute function public.novelight_refresh_badges_from_valid_read();

create trigger scout_badge_refresh_seed
after insert on public.light_seeds
for each row execute function public.novelight_refresh_badges_from_seed();

create trigger scout_badge_refresh_discovery
after insert or update of best_rank_delta, highest_rank_seen or delete on public.seed_discovery_state
for each row execute function public.novelight_refresh_badges_from_discovery();

create trigger scout_badge_refresh_rating
after insert or update or delete on public.novel_star_ratings
for each row execute function public.novelight_refresh_badges_from_rating();

create trigger scout_badge_refresh_xp
after insert on public.scout_xp_ledger
for each row execute function public.novelight_refresh_badges_from_xp();

create trigger scout_badge_refresh_point
after insert or update of status, point_value or delete on public.scout_point_ledger
for each row execute function public.novelight_refresh_badges_from_point();

create trigger scout_badge_refresh_rank_state
after insert or update of is_completed or delete on public.novel_rank_state
for each row execute function public.novelight_refresh_badges_from_rank_state();

-- Reconstruct current progress and acquired badges from existing Source of Truth
-- without issuing any historical Reader Badge Scout Point.
do $$
declare
  v_uid uuid;
begin
  for v_uid in select p.id from public.profiles p loop
    perform public.novelight_refresh_scout_badges_for_user(v_uid, false);
  end loop;
end
$$;

update public.scout_badge_runtime_config
   set rule_version = 'badge-system-beta-v1',
       updated_at = now()
 where id = 1;

comment on table public.scout_badge_definitions is
  'Data-driven Reader, Author and Limited badge definitions. Internal badge IDs are stable and display names remain replaceable.';
comment on column public.scout_badge_definitions.metric_key is
  'Metric key consumed by the generic badge evaluator; separate from condition type and display name.';
comment on column public.scout_badge_definitions.condition_config is
  'Data-driven condition configuration, including composite_all components.';
comment on function public.novelight_scout_badge_metric_snapshot(uuid) is
  'Rebuildable owner metric snapshot from current authoritative SCOUT/novel sources.';
comment on function public.novelight_evaluate_scout_badges(uuid, boolean) is
  'Generic threshold/counter/boolean/composite_all badge evaluator. Point issuance requires explicit event-time award mode.';

commit;
