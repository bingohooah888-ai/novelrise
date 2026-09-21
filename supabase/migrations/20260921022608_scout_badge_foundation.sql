-- NOVELIGHT SCOUT RECORD badge foundation.
-- Implements the exact badge infrastructure and the fully enumerated Author Badge
-- and Limited/Special rules from the accepted beta specification.
--
-- Reader Badge 100 individual conditions are intentionally NOT invented here.
-- The accepted specification references an earlier 100-badge draft but does not
-- enumerate it. The schema/RPCs below are data-driven so those exact definitions
-- can be inserted later without changing badge storage or UI contracts.
--
-- Retroactive activity badges remain disabled. Author metrics start from this
-- migration forward; existing Founding Author / beta participant qualifications
-- are identity qualifications, not activity backfill.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921022608'));

do $$
begin
  if to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'SCOUT RECORD beta core is required before badge foundation';
  end if;

  if to_regclass('public.scout_badge_definitions') is not null
     or to_regclass('public.user_scout_badges') is not null then
    raise exception 'SCOUT badge foundation already exists or requires reconciliation';
  end if;
end
$$;

create table public.scout_badge_runtime_config (
  id smallint primary key default 1 check (id = 1),
  started_at timestamptz not null default now(),
  retroactive_policy text not null default 'none'
    check (retroactive_policy in ('none', 'future-approved')),
  rule_version text not null default 'beta-2026-09-21',
  updated_at timestamptz not null default now()
);

insert into public.scout_badge_runtime_config (id) values (1);

create table public.scout_badge_definitions (
  badge_id text primary key,
  badge_category text not null
    check (badge_category in ('reader', 'author', 'limited')),
  difficulty text not null
    check (difficulty in ('easy', 'normal', 'hard', 'special')),
  display_name text not null,
  description text not null,
  condition_type text not null,
  target_value bigint not null check (target_value > 0),
  point_reward integer not null default 0 check (point_reward >= 0),
  is_limited boolean not null default false,
  is_hidden boolean not null default false,
  sort_order integer not null,
  enabled boolean not null default true,
  icon_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_badge_id_length check (char_length(badge_id) between 3 and 100),
  constraint scout_badge_condition_length check (char_length(condition_type) between 3 and 100)
);

create unique index scout_badge_category_sort_idx
  on public.scout_badge_definitions (badge_category, sort_order);

create table public.user_scout_badges (
  user_id uuid not null,
  badge_id text not null references public.scout_badge_definitions(badge_id) on delete restrict,
  progress_value bigint not null default 0 check (progress_value >= 0),
  progress_percent numeric(5,2) not null default 0
    check (progress_percent between 0 and 100),
  earned_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'earned', 'revoked')),
  is_public boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create index user_scout_badges_earned_idx
  on public.user_scout_badges (user_id, earned_at desc)
  where earned_at is not null;

create table public.scout_badge_metric_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  metric_type text not null,
  metric_delta bigint not null check (metric_delta > 0),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint scout_badge_metric_type_length check (char_length(metric_type) between 3 and 100),
  constraint scout_badge_dedupe_key_length check (char_length(dedupe_key) between 5 and 300)
);

create index scout_badge_metric_events_user_idx
  on public.scout_badge_metric_events (user_id, occurred_at desc);

create table public.scout_badge_metric_state (
  user_id uuid not null,
  metric_type text not null,
  metric_value bigint not null default 0 check (metric_value >= 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, metric_type)
);

create table public.scout_episode_badge_state (
  episode_id bigint primary key,
  author_id uuid not null,
  max_published_chars integer not null default 0 check (max_published_chars >= 0),
  first_seen_published_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.scout_badge_runtime_config enable row level security;
alter table public.scout_badge_definitions enable row level security;
alter table public.user_scout_badges enable row level security;
alter table public.scout_badge_metric_events enable row level security;
alter table public.scout_badge_metric_state enable row level security;
alter table public.scout_episode_badge_state enable row level security;

revoke all on table public.scout_badge_runtime_config from public, anon, authenticated;
revoke all on table public.scout_badge_definitions from public, anon, authenticated;
revoke all on table public.user_scout_badges from public, anon, authenticated;
revoke all on table public.scout_badge_metric_events from public, anon, authenticated;
revoke all on table public.scout_badge_metric_state from public, anon, authenticated;
revoke all on table public.scout_episode_badge_state from public, anon, authenticated;

-- Existing published episodes are baseline-only. This prevents a later edit to
-- an already-published episode from retroactively awarding all historical words.
insert into public.scout_episode_badge_state (
  episode_id,
  author_id,
  max_published_chars,
  first_seen_published_at
)
select
  e.id,
  e.user_id,
  char_length(coalesce(e.content, '')),
  coalesce(e.created_at, now())
from public.episodes e
where e.status = 'published'
on conflict (episode_id) do nothing;

-- Author Badge 40. Display names are intentionally condition-oriented/provisional.
insert into public.scout_badge_definitions (
  badge_id, badge_category, difficulty, display_name, description,
  condition_type, target_value, point_reward, is_limited, sort_order, metadata
) values
  ('author_badge_001','author','easy','初作品公開','初めて作品を公開する','author_work_published',1,0,false,1,'{"spec_no":1}'::jsonb),
  ('author_badge_002','author','easy','初エピソード公開','初めてエピソードを公開する','author_episode_published',1,0,false,2,'{"spec_no":2}'::jsonb),
  ('author_badge_003','author','easy','初ユニーク読者','初めてユニーク読者を獲得する','author_unique_readers',1,0,false,3,'{"spec_no":3}'::jsonb),
  ('author_badge_004','author','easy','初お気に入り','初めてお気に入りを獲得する','author_favorites_received',1,0,false,4,'{"spec_no":4}'::jsonb),
  ('author_badge_005','author','easy','初コメント','初めてコメントを獲得する','author_comments_received',1,0,false,5,'{"spec_no":5}'::jsonb),

  ('author_badge_006','author','normal','累計10話公開','公開エピソード累計10話','author_episode_published',10,0,false,6,'{"spec_no":6}'::jsonb),
  ('author_badge_007','author','normal','累計25話公開','公開エピソード累計25話','author_episode_published',25,0,false,7,'{"spec_no":7}'::jsonb),
  ('author_badge_008','author','normal','累計50話公開','公開エピソード累計50話','author_episode_published',50,0,false,8,'{"spec_no":8}'::jsonb),
  ('author_badge_009','author','normal','累計100話公開','公開エピソード累計100話','author_episode_published',100,0,false,9,'{"spec_no":9}'::jsonb),
  ('author_badge_010','author','normal','累計250話公開','公開エピソード累計250話','author_episode_published',250,0,false,10,'{"spec_no":10}'::jsonb),

  ('author_badge_011','author','normal','累計1万字','公開文字数累計1万字','author_words_published',10000,0,false,11,'{"spec_no":11}'::jsonb),
  ('author_badge_012','author','normal','累計5万字','公開文字数累計5万字','author_words_published',50000,0,false,12,'{"spec_no":12}'::jsonb),
  ('author_badge_013','author','normal','累計10万字','公開文字数累計10万字','author_words_published',100000,0,false,13,'{"spec_no":13}'::jsonb),
  ('author_badge_014','author','normal','累計25万字','公開文字数累計25万字','author_words_published',250000,0,false,14,'{"spec_no":14}'::jsonb),
  ('author_badge_015','author','normal','累計50万字','公開文字数累計50万字','author_words_published',500000,0,false,15,'{"spec_no":15}'::jsonb),

  ('author_badge_016','author','normal','初完結','初めて作品を完結する','author_works_completed',1,0,false,16,'{"spec_no":16}'::jsonb),
  ('author_badge_017','author','normal','3作品完結','3作品を完結する','author_works_completed',3,0,false,17,'{"spec_no":17}'::jsonb),
  ('author_badge_018','author','normal','5作品完結','5作品を完結する','author_works_completed',5,0,false,18,'{"spec_no":18}'::jsonb),

  ('author_badge_019','author','normal','2作品公開','2作品を公開する','author_work_published',2,0,false,19,'{"spec_no":19}'::jsonb),
  ('author_badge_020','author','normal','5作品公開','5作品を公開する','author_work_published',5,0,false,20,'{"spec_no":20}'::jsonb),
  ('author_badge_021','author','normal','10作品公開','10作品を公開する','author_work_published',10,0,false,21,'{"spec_no":21}'::jsonb),

  ('author_badge_022','author','normal','累計ユニーク読者10','累計ユニーク読者10人','author_unique_readers',10,0,false,22,'{"spec_no":22}'::jsonb),
  ('author_badge_023','author','normal','累計ユニーク読者50','累計ユニーク読者50人','author_unique_readers',50,0,false,23,'{"spec_no":23}'::jsonb),
  ('author_badge_024','author','normal','累計ユニーク読者100','累計ユニーク読者100人','author_unique_readers',100,0,false,24,'{"spec_no":24}'::jsonb),
  ('author_badge_025','author','normal','累計ユニーク読者500','累計ユニーク読者500人','author_unique_readers',500,0,false,25,'{"spec_no":25}'::jsonb),

  ('author_badge_026','author','normal','累計お気に入り10','累計お気に入り10件','author_favorites_received',10,0,false,26,'{"spec_no":26}'::jsonb),
  ('author_badge_027','author','normal','累計お気に入り50','累計お気に入り50件','author_favorites_received',50,0,false,27,'{"spec_no":27}'::jsonb),
  ('author_badge_028','author','normal','累計お気に入り100','累計お気に入り100件','author_favorites_received',100,0,false,28,'{"spec_no":28}'::jsonb),

  ('author_badge_029','author','normal','累計コメント10','累計コメント10件','author_comments_received',10,0,false,29,'{"spec_no":29}'::jsonb),
  ('author_badge_030','author','normal','累計コメント50','累計コメント50件','author_comments_received',50,0,false,30,'{"spec_no":30}'::jsonb),

  ('author_badge_031','author','normal','初LIGHT SEED獲得','初めてLIGHT SEEDを受け取る','author_seeds_received',1,0,false,31,'{"spec_no":31}'::jsonb),
  ('author_badge_032','author','normal','累計LIGHT SEED 10','累計LIGHT SEED 10個','author_seeds_received',10,0,false,32,'{"spec_no":32}'::jsonb),
  ('author_badge_033','author','normal','累計LIGHT SEED 50','累計LIGHT SEED 50個','author_seeds_received',50,0,false,33,'{"spec_no":33}'::jsonb),

  ('author_badge_034','author','normal','SEED後 +2 Rank','自作品がSEED後に+2 Rank以上成長する','author_seed_growth_plus2_works',1,0,false,34,'{"spec_no":34}'::jsonb),
  ('author_badge_035','author','normal','SEED後 +3 Rank','自作品がSEED後に+3 Rank以上成長する','author_seed_growth_plus3_works',1,0,false,35,'{"spec_no":35}'::jsonb),

  ('author_badge_036','author','hard','累計100万字','公開文字数累計100万字','author_words_published',1000000,0,false,36,'{"spec_no":36}'::jsonb),
  ('author_badge_037','author','hard','10作品完結','10作品を完結する','author_works_completed',10,0,false,37,'{"spec_no":37}'::jsonb),
  ('author_badge_038','author','hard','累計ユニーク読者1,000','累計ユニーク読者1,000人','author_unique_readers',1000,0,false,38,'{"spec_no":38}'::jsonb),
  ('author_badge_039','author','hard','累計お気に入り500','累計お気に入り500件','author_favorites_received',500,0,false,39,'{"spec_no":39}'::jsonb),
  ('author_badge_040','author','hard','5作品がSEED後 +2 Rank','5作品がSEED後に+2 Rank以上成長する','author_seed_growth_plus2_works',5,0,false,40,'{"spec_no":40}'::jsonb),

  ('limited_founding_author','limited','special','Founding Author','先行登録順に付与される永久限定資格','limited_founding_author',1,0,true,1,'{"source":"founding_authors"}'::jsonb),
  ('limited_beta_participant','limited','special','β Participant','β参加者へ付与される永久限定資格','limited_beta_participant',1,0,true,2,'{"source":"beta_participants"}'::jsonb);

-- Existing Limited/Special qualifications are permanent identity facts, not
-- activity rewards. Materialize them now so public profiles do not depend on
-- the owner opening SCOUT RECORD first.
insert into public.user_scout_badges (
  user_id, badge_id, progress_value, progress_percent, earned_at,
  status, is_public, metadata, created_at, updated_at
)
select
  f.author_id,
  'limited_founding_author',
  1,
  100,
  coalesce(f.qualified_at, now()),
  'earned',
  true,
  pg_catalog.jsonb_build_object('founding_number', f.founding_number),
  now(),
  now()
from public.founding_authors f
on conflict (user_id, badge_id) do update
  set progress_value = 1,
      progress_percent = 100,
      earned_at = coalesce(public.user_scout_badges.earned_at, excluded.earned_at),
      status = 'earned',
      metadata = public.user_scout_badges.metadata || excluded.metadata,
      updated_at = now();

insert into public.user_scout_badges (
  user_id, badge_id, progress_value, progress_percent, earned_at,
  status, is_public, metadata, created_at, updated_at
)
select
  b.auth_user_id,
  'limited_beta_participant',
  1,
  100,
  coalesce(b.qualified_at, now()),
  'earned',
  true,
  pg_catalog.jsonb_build_object('qualification_source', 'beta_participants'),
  now(),
  now()
from public.beta_participants b
on conflict (user_id, badge_id) do update
  set progress_value = 1,
      progress_percent = 100,
      earned_at = coalesce(public.user_scout_badges.earned_at, excluded.earned_at),
      status = 'earned',
      metadata = public.user_scout_badges.metadata || excluded.metadata,
      updated_at = now();

create or replace function public.novelight_record_scout_badge_metric(
  p_user_id uuid,
  p_metric_type text,
  p_metric_delta bigint,
  p_dedupe_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted uuid;
begin
  if p_user_id is null
     or p_metric_type is null
     or char_length(p_metric_type) < 3
     or p_metric_delta is null
     or p_metric_delta <= 0
     or p_dedupe_key is null
     or char_length(p_dedupe_key) < 5 then
    return false;
  end if;

  insert into public.scout_badge_metric_events (
    user_id, metric_type, metric_delta, dedupe_key, metadata
  ) values (
    p_user_id, p_metric_type, p_metric_delta, p_dedupe_key, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (dedupe_key) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    return false;
  end if;

  insert into public.scout_badge_metric_state (
    user_id, metric_type, metric_value, metadata, updated_at
  ) values (
    p_user_id, p_metric_type, p_metric_delta, coalesce(p_metadata, '{}'::jsonb), now()
  )
  on conflict (user_id, metric_type) do update
    set metric_value = public.scout_badge_metric_state.metric_value + excluded.metric_value,
        metadata = public.scout_badge_metric_state.metadata || excluded.metadata,
        updated_at = now();

  return true;
end
$$;

revoke all on function public.novelight_record_scout_badge_metric(uuid, text, bigint, text, jsonb)
  from public, anon, authenticated;

create or replace function public.novelight_track_author_work_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null or new.first_published_at is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.first_published_at is null then
    perform public.novelight_record_scout_badge_metric(
      new.user_id,
      'author_work_published',
      1,
      'author_work_published:' || new.id::text,
      pg_catalog.jsonb_build_object('novel_id', new.id::text)
    );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_track_author_work_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_work
after insert or update of first_published_at on public.novels
for each row execute function public.novelight_track_author_work_badges();

create or replace function public.novelight_track_author_episode_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chars integer := char_length(coalesce(new.content, ''));
  v_previous_max integer;
  v_delta integer;
begin
  if new.user_id is null or new.status <> 'published' then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.status is distinct from 'published' then
    perform public.novelight_record_scout_badge_metric(
      new.user_id,
      'author_episode_published',
      1,
      'author_episode_published:' || new.id::text,
      pg_catalog.jsonb_build_object('episode_id', new.id::text, 'novel_id', new.novel_id::text)
    );
  end if;

  select s.max_published_chars
    into v_previous_max
    from public.scout_episode_badge_state s
   where s.episode_id = new.id
   for update;

  if v_previous_max is null then
    insert into public.scout_episode_badge_state (
      episode_id, author_id, max_published_chars, first_seen_published_at, updated_at
    ) values (
      new.id, new.user_id, v_chars, now(), now()
    )
    on conflict (episode_id) do nothing;

    if v_chars > 0 then
      perform public.novelight_record_scout_badge_metric(
        new.user_id,
        'author_words_published',
        v_chars,
        'author_words_initial:' || new.id::text,
        pg_catalog.jsonb_build_object('episode_id', new.id::text, 'novel_id', new.novel_id::text)
      );
    end if;
    return new;
  end if;

  if v_chars > v_previous_max then
    v_delta := v_chars - v_previous_max;

    update public.scout_episode_badge_state
       set max_published_chars = v_chars,
           updated_at = now()
     where episode_id = new.id;

    perform public.novelight_record_scout_badge_metric(
      new.user_id,
      'author_words_published',
      v_delta,
      'author_words_growth:' || new.id::text || ':' || v_chars::text,
      pg_catalog.jsonb_build_object(
        'episode_id', new.id::text,
        'novel_id', new.novel_id::text,
        'max_published_chars', v_chars
      )
    );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_track_author_episode_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_episode
after insert or update of status, content on public.episodes
for each row execute function public.novelight_track_author_episode_badges();

create or replace function public.novelight_track_author_favorite_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  select n.user_id into v_author
  from public.novels n
  where n.id = new.novel_id;

  if v_author is null or new.user_id = v_author then
    return new;
  end if;

  perform public.novelight_record_scout_badge_metric(
    v_author,
    'author_favorites_received',
    1,
    'author_favorite:' || v_author::text || ':' || new.novel_id::text || ':' || new.user_id::text,
    pg_catalog.jsonb_build_object('novel_id', new.novel_id::text, 'reader_id', new.user_id::text)
  );

  return new;
end
$$;

revoke all on function public.novelight_track_author_favorite_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_favorite
after insert on public.favorites
for each row execute function public.novelight_track_author_favorite_badges();

create or replace function public.novelight_track_author_comment_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  select n.user_id into v_author
  from public.novels n
  where n.id = new.novel_id;

  if v_author is null or new.user_id = v_author then
    return new;
  end if;

  perform public.novelight_record_scout_badge_metric(
    v_author,
    'author_comments_received',
    1,
    'author_comment:' || new.id::text,
    pg_catalog.jsonb_build_object('novel_id', new.novel_id::text, 'comment_id', new.id::text)
  );

  return new;
end
$$;

revoke all on function public.novelight_track_author_comment_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_comment
after insert on public.novel_comments
for each row execute function public.novelight_track_author_comment_badges();

create or replace function public.novelight_track_author_unique_reader_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id_snapshot is null
     or new.reader_id is null
     or new.author_id_snapshot = new.reader_id then
    return new;
  end if;

  perform public.novelight_record_scout_badge_metric(
    new.author_id_snapshot,
    'author_unique_readers',
    1,
    'author_unique_reader:' || new.author_id_snapshot::text || ':' || new.reader_id::text,
    pg_catalog.jsonb_build_object('reader_id', new.reader_id::text)
  );

  return new;
end
$$;

revoke all on function public.novelight_track_author_unique_reader_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_unique_reader
after insert on public.valid_read_events
for each row execute function public.novelight_track_author_unique_reader_badges();

create or replace function public.novelight_track_author_seed_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id_snapshot is null then
    return new;
  end if;

  perform public.novelight_record_scout_badge_metric(
    new.author_id_snapshot,
    'author_seeds_received',
    1,
    'author_seed_received:' || new.id::text,
    pg_catalog.jsonb_build_object(
      'seed_id', new.id::text,
      'novel_id', new.novel_id_snapshot,
      'seed_type', new.seed_type
    )
  );

  return new;
end
$$;

revoke all on function public.novelight_track_author_seed_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_seed
after insert on public.light_seeds
for each row execute function public.novelight_track_author_seed_badges();

create or replace function public.novelight_track_author_completion_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id_snapshot is null or new.is_completed is not true then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.is_completed is distinct from true then
    perform public.novelight_record_scout_badge_metric(
      new.author_id_snapshot,
      'author_works_completed',
      1,
      'author_work_completed:' || new.novel_id_snapshot,
      pg_catalog.jsonb_build_object('novel_id', new.novel_id_snapshot)
    );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_track_author_completion_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_completion
after insert or update of is_completed on public.novel_rank_state
for each row execute function public.novelight_track_author_completion_badges();

create or replace function public.novelight_track_author_seed_growth_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_novel text;
  v_old_delta integer := 0;
  v_new_delta integer := greatest(coalesce(new.best_rank_delta, 0), 0);
begin
  select s.author_id_snapshot, s.novel_id_snapshot
    into v_author, v_novel
    from public.light_seeds s
   where s.id = new.seed_id;

  if v_author is null or v_novel is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_delta := greatest(coalesce(old.best_rank_delta, 0), 0);
  end if;

  if v_new_delta >= 2 and v_old_delta < 2 then
    perform public.novelight_record_scout_badge_metric(
      v_author,
      'author_seed_growth_plus2_works',
      1,
      'author_seed_growth_plus2:' || v_author::text || ':' || v_novel,
      pg_catalog.jsonb_build_object('novel_id', v_novel)
    );
  end if;

  if v_new_delta >= 3 and v_old_delta < 3 then
    perform public.novelight_record_scout_badge_metric(
      v_author,
      'author_seed_growth_plus3_works',
      1,
      'author_seed_growth_plus3:' || v_author::text || ':' || v_novel,
      pg_catalog.jsonb_build_object('novel_id', v_novel)
    );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_track_author_seed_growth_badges()
  from public, anon, authenticated;

create trigger scout_badge_track_author_seed_growth
after insert or update of best_rank_delta on public.seed_discovery_state
for each row execute function public.novelight_track_author_seed_growth_badges();

create or replace function public.novelight_apply_scout_badge_progress(
  p_user_id uuid,
  p_badge_id text,
  p_progress_value bigint,
  p_metadata jsonb default '{}'::jsonb
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
  v_percent numeric(5,2);
  v_earned boolean;
  v_newly_earned boolean := false;
begin
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
    and b.badge_id = p_badge_id;

  if found and v_existing.status = 'revoked' then
    return;
  end if;

  if v_existing.user_id is not null then
    v_progress := greatest(v_progress, v_existing.progress_value);
  end if;

  v_percent := least(
    100::numeric,
    round((v_progress::numeric / v_definition.target_value::numeric) * 100, 2)
  );
  v_earned := v_progress >= v_definition.target_value
    or coalesce(v_existing.status = 'earned', false);
  v_newly_earned := v_earned
    and coalesce(v_existing.status <> 'earned', true);

  insert into public.user_scout_badges (
    user_id, badge_id, progress_value, progress_percent, earned_at,
    status, is_public, metadata, updated_at
  ) values (
    p_user_id,
    p_badge_id,
    v_progress,
    v_percent,
    case when v_earned then now() else null end,
    case when v_earned then 'earned' else 'in_progress' end,
    true,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (user_id, badge_id) do update
    set progress_value = excluded.progress_value,
        progress_percent = excluded.progress_percent,
        earned_at = coalesce(public.user_scout_badges.earned_at, excluded.earned_at),
        status = case
          when public.user_scout_badges.status = 'earned' then 'earned'
          else excluded.status
        end,
        metadata = public.user_scout_badges.metadata || excluded.metadata,
        updated_at = now();

  if v_newly_earned
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
        'display_name', v_definition.display_name,
        'rule_version', 'chapter49-badge-v1'
      )
    )
    on conflict (event_key) do nothing;
  end if;
end
$$;

revoke all on function public.novelight_apply_scout_badge_progress(uuid, text, bigint, jsonb)
  from public, anon, authenticated;

create or replace function public.novelight_refresh_my_scout_badges()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_definition record;
  v_progress bigint;
  v_founding_number bigint;
  v_beta boolean;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  for v_definition in
    select d.badge_id, d.badge_category, d.condition_type
    from public.scout_badge_definitions d
    where d.enabled
      and d.badge_category = 'author'
    order by d.sort_order
  loop
    select coalesce(s.metric_value, 0)::bigint
      into v_progress
      from public.scout_badge_metric_state s
     where s.user_id = v_uid
       and s.metric_type = v_definition.condition_type;

    perform public.novelight_apply_scout_badge_progress(
      v_uid,
      v_definition.badge_id,
      coalesce(v_progress, 0),
      pg_catalog.jsonb_build_object('retroactive_policy', 'none')
    );
    v_count := v_count + 1;
  end loop;

  select f.founding_number
    into v_founding_number
    from public.founding_authors f
   where f.author_id = v_uid;

  perform public.novelight_apply_scout_badge_progress(
    v_uid,
    'limited_founding_author',
    case when v_founding_number is null then 0 else 1 end,
    case
      when v_founding_number is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('founding_number', v_founding_number)
    end
  );
  v_count := v_count + 1;

  select exists (
    select 1
    from public.beta_participants b
    where b.auth_user_id = v_uid
  ) into v_beta;

  perform public.novelight_apply_scout_badge_progress(
    v_uid,
    'limited_beta_participant',
    case when v_beta then 1 else 0 end,
    '{}'::jsonb
  );
  v_count := v_count + 1;

  return v_count;
end
$$;

revoke all on function public.novelight_refresh_my_scout_badges()
  from public, anon;
grant execute on function public.novelight_refresh_my_scout_badges()
  to authenticated;

create or replace function public.novelight_scout_badges()
returns table (
  badge_id text,
  badge_category text,
  difficulty text,
  display_name text,
  description text,
  condition_type text,
  target_value bigint,
  point_reward integer,
  is_limited boolean,
  is_hidden boolean,
  sort_order integer,
  progress_value bigint,
  progress_percent numeric,
  earned_at timestamptz,
  status text,
  is_public boolean,
  metadata jsonb
)
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

  perform public.novelight_refresh_my_scout_badges();

  return query
  select
    d.badge_id,
    d.badge_category,
    d.difficulty,
    case
      when d.is_hidden and b.earned_at is null then '???'
      when d.badge_id = 'limited_founding_author'
           and (b.metadata->>'founding_number') ~ '^[0-9]+$'
        then 'Founding Author #' || lpad((b.metadata->>'founding_number'), 3, '0')
      else d.display_name
    end,
    case
      when d.is_hidden and b.earned_at is null then 'Secret Badge'
      else d.description
    end,
    d.condition_type,
    d.target_value,
    d.point_reward,
    d.is_limited,
    d.is_hidden,
    d.sort_order,
    coalesce(b.progress_value, 0),
    coalesce(b.progress_percent, 0),
    b.earned_at,
    coalesce(b.status, 'in_progress'),
    coalesce(b.is_public, true),
    coalesce(b.metadata, '{}'::jsonb)
  from public.scout_badge_definitions d
  left join public.user_scout_badges b
    on b.user_id = v_uid
   and b.badge_id = d.badge_id
  where d.enabled
  order by
    case d.badge_category when 'reader' then 1 when 'author' then 2 else 3 end,
    d.sort_order;
end
$$;

revoke all on function public.novelight_scout_badges()
  from public, anon;
grant execute on function public.novelight_scout_badges()
  to authenticated;

create or replace function public.novelight_set_scout_badge_visibility(
  p_badge_id text,
  p_is_public boolean
)
returns boolean
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

  update public.user_scout_badges b
     set is_public = coalesce(p_is_public, false),
         updated_at = now()
   where b.user_id = v_uid
     and b.badge_id = p_badge_id
     and b.status = 'earned';

  return found;
end
$$;

revoke all on function public.novelight_set_scout_badge_visibility(text, boolean)
  from public, anon;
grant execute on function public.novelight_set_scout_badge_visibility(text, boolean)
  to authenticated;

create or replace function public.novelight_public_scout_record(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_xp bigint;
  v_level smallint;
  v_rank_tier smallint;
  v_discoveries bigint;
  v_badges jsonb;
  v_representative jsonb;
begin
  if p_user_id is null
     or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return null;
  end if;

  select t.cumulative_xp into v_cap
  from public.scout_level_thresholds t
  where t.level = 30;

  select least(coalesce(sum(x.xp_value), 0), v_cap)::bigint
    into v_xp
    from public.scout_xp_ledger x
   where x.user_id = p_user_id;

  v_level := public.novelight_scout_level_for_xp(v_xp);
  v_rank_tier := least(3, ((v_level - 1) / 10) + 1)::smallint;

  select count(*)::bigint
    into v_discoveries
    from public.seed_discovery_state d
   where d.reader_id = p_user_id
     and (
       d.best_rank_delta >= 2
       or (d.rank_at_seed = 5 and d.highest_rank_seen = 6)
     );

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'badge_id', d.badge_id,
        'category', d.badge_category,
        'difficulty', d.difficulty,
        'display_name',
          case
            when d.badge_id = 'limited_founding_author'
                 and (b.metadata->>'founding_number') ~ '^[0-9]+$'
              then 'Founding Author #' || lpad((b.metadata->>'founding_number'), 3, '0')
            else d.display_name
          end,
        'earned_at', b.earned_at
      )
      order by d.badge_category, d.sort_order
    ),
    '[]'::jsonb
  )
  into v_badges
  from public.user_scout_badges b
  join public.scout_badge_definitions d on d.badge_id = b.badge_id
  where b.user_id = p_user_id
    and b.status = 'earned'
    and b.is_public
    and d.enabled;

  select coalesce(
    pg_catalog.jsonb_agg(row_data order by sort_key desc),
    '[]'::jsonb
  )
  into v_representative
  from (
    select
      pg_catalog.jsonb_build_object(
        'novel_id', d.novel_id_snapshot,
        'title', case when n.status = 'published' then n.title else null end,
        'seed_type', d.seed_type,
        'rank_delta', d.best_rank_delta,
        'nova_prediction', d.rank_at_seed = 5 and d.highest_rank_seen = 6
      ) as row_data,
      greatest(d.best_rank_delta, 0)::integer as sort_key
    from public.seed_discovery_state d
    left join public.novels n on n.id::text = d.novel_id_snapshot
    where d.reader_id = p_user_id
      and (
        d.best_rank_delta >= 2
        or (d.rank_at_seed = 5 and d.highest_rank_seen = 6)
      )
    order by
      (d.rank_at_seed = 5 and d.highest_rank_seen = 6) desc,
      d.best_rank_delta desc,
      d.updated_at desc
    limit 3
  ) q;

  return pg_catalog.jsonb_build_object(
    'level', v_level,
    'rank_tier', v_rank_tier,
    'discovery_success_count', v_discoveries,
    'badges', v_badges,
    'representative_discoveries', v_representative
  );
end
$$;

revoke all on function public.novelight_public_scout_record(uuid)
  from public;
grant execute on function public.novelight_public_scout_record(uuid)
  to anon, authenticated;

comment on table public.scout_badge_definitions is
  'Data-driven SCOUT badge definitions. Reader 100 exact rows are intentionally deferred until the accepted prior 100-condition list is recovered.';
comment on table public.scout_badge_metric_events is
  'Private monotonic badge metric event ledger starting at Chapter 49 badge activation; no activity backfill.';
comment on function public.novelight_scout_badges() is
  'Authenticated owner-only SCOUT badge collection with progress and visibility.';
comment on function public.novelight_public_scout_record(uuid) is
  'Public-safe SCOUT summary: Level, Rank tier, public earned badges, discovery count and representative discoveries only.';

commit;
