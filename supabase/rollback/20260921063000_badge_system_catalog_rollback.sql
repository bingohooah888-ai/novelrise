\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921063000:rollback'));

drop trigger if exists scout_metric_state_refresh_badges on public.scout_badge_metric_state;
drop trigger if exists scout_comment_refresh_reader_badges on public.novel_comments;
drop trigger if exists scout_point_refresh_reader_badges on public.scout_point_ledger;
drop trigger if exists scout_xp_refresh_reader_badges on public.scout_xp_ledger;
drop trigger if exists scout_discovery_refresh_reader_badges on public.seed_discovery_state;
drop trigger if exists scout_event_refresh_reader_badges on public.scout_event_ledger;

drop function if exists public.novelight_refresh_badges_from_metric_state();
drop function if exists public.novelight_refresh_reader_badges_from_comment_state();
drop function if exists public.novelight_refresh_reader_badges_from_point();
drop function if exists public.novelight_refresh_reader_badges_from_xp();
drop function if exists public.novelight_refresh_reader_badges_from_discovery();
drop function if exists public.novelight_refresh_reader_badges_from_scout_event();
drop function if exists public.novelight_refresh_scout_badges_for_user(uuid, boolean);
drop function if exists public.novelight_apply_scout_badge_evaluation(
  uuid, text, bigint, numeric, boolean, jsonb, boolean
);
drop function if exists public.novelight_evaluate_scout_badge(text, jsonb);
drop function if exists public.novelight_author_badge_metrics(uuid);
drop function if exists public.novelight_reader_badge_metrics(uuid);

-- Restore per-user Author progress to the deployed provisional IDs before
-- disabling/removing the canonical aliases.
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
  m.old_id,
  b.progress_value,
  b.progress_percent,
  b.earned_at,
  b.status,
  b.is_public,
  b.metadata || pg_catalog.jsonb_build_object('rolled_back_from_badge_id', m.new_id),
  b.created_at,
  now()
from public.user_scout_badges b
join author_id_map m on m.new_id = b.badge_id
on conflict (user_id, badge_id) do update
  set progress_value = greatest(public.user_scout_badges.progress_value, excluded.progress_value),
      progress_percent = greatest(public.user_scout_badges.progress_percent, excluded.progress_percent),
      earned_at = case
        when public.user_scout_badges.earned_at is null then excluded.earned_at
        when excluded.earned_at is null then public.user_scout_badges.earned_at
        else least(public.user_scout_badges.earned_at, excluded.earned_at)
      end,
      status = case
        when public.user_scout_badges.status='earned' or excluded.status='earned' then 'earned'
        when public.user_scout_badges.status='revoked' then 'revoked'
        else excluded.status
      end,
      is_public = public.user_scout_badges.is_public,
      metadata = public.user_scout_badges.metadata || excluded.metadata,
      updated_at = now();

delete from public.user_scout_badges
 where badge_id in (
   'author_novel_001',
   'author_episode_001',
   'author_reader_001',
   'author_favorite_001',
   'author_comment_001',
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
   'author_novel_002',
   'author_novel_005',
   'author_novel_010',
   'author_unique_reader_010',
   'author_unique_reader_050',
   'author_unique_reader_100',
   'author_unique_reader_500',
   'author_favorite_010',
   'author_favorite_050',
   'author_favorite_100',
   'author_comment_010',
   'author_comment_050',
   'author_seed_received_001',
   'author_seed_received_010',
   'author_seed_received_050',
   'author_discovered_plus2_001',
   'author_discovered_plus3_001',
   'author_chars_1m',
   'author_completed_010',
   'author_unique_reader_1000',
   'author_favorite_500',
   'author_discovered_plus2_005'
 );

-- Zero-progress Reader rows are derived cache and may be removed safely.
delete from public.user_scout_badges b
 where b.badge_id like 'reader_%'
   and b.status='in_progress'
   and b.progress_value=0
   and not exists (
     select 1
       from public.scout_point_ledger p
      where p.user_id=b.user_id
        and p.point_kind='badge'
        and p.metadata->>'badge_id'=b.badge_id
   );

-- Free the original Author sort slots before re-enabling the prior catalog.
update public.scout_badge_definitions
   set sort_order = 2000 + coalesce((metadata->>'spec_no')::integer, sort_order),
       enabled = false,
       updated_at = now()
 where badge_id in (
   'author_novel_001',
   'author_episode_001',
   'author_reader_001',
   'author_favorite_001',
   'author_comment_001',
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
   'author_novel_002',
   'author_novel_005',
   'author_novel_010',
   'author_unique_reader_010',
   'author_unique_reader_050',
   'author_unique_reader_100',
   'author_unique_reader_500',
   'author_favorite_010',
   'author_favorite_050',
   'author_favorite_100',
   'author_comment_010',
   'author_comment_050',
   'author_seed_received_001',
   'author_seed_received_010',
   'author_seed_received_050',
   'author_discovered_plus2_001',
   'author_discovered_plus3_001',
   'author_chars_1m',
   'author_completed_010',
   'author_unique_reader_1000',
   'author_favorite_500',
   'author_discovered_plus2_005'
 );

alter table public.scout_badge_definitions
  drop constraint if exists scout_badge_condition_type_supported;

update public.scout_badge_definitions
   set sort_order = coalesce((metadata->>'spec_no')::integer, sort_order - 1000),
       enabled = true,
       condition_type = coalesce(metric_key, condition_type),
       updated_at = now()
 where badge_category='author'
   and badge_id ~ '^author_badge_[0-9]{3}$';

-- Restore the Chapter 49 foundation refresh implementation.
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

do $$
declare
  v_reader_history boolean;
  v_badge_rewards boolean;
begin
  select exists (
    select 1
      from public.user_scout_badges b
     where b.badge_id like 'reader_%'
       and (
         b.status in ('earned','revoked')
         or b.progress_value > 0
         or b.progress_percent > 0
       )
  ) into v_reader_history;

  select exists (
    select 1
      from public.scout_point_ledger p
     where p.point_kind='badge'
       and p.metadata->>'rule_version'='badge-system-beta-2026-09-21'
  ) into v_badge_rewards;

  if not v_reader_history and not v_badge_rewards then
    delete from public.user_scout_badges where badge_id like 'reader_%';
    delete from public.scout_badge_definitions where badge_id like 'reader_%';
    delete from public.scout_badge_definitions
     where badge_id in (
       'author_novel_001',
       'author_episode_001',
       'author_reader_001',
       'author_favorite_001',
       'author_comment_001',
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
       'author_novel_002',
       'author_novel_005',
       'author_novel_010',
       'author_unique_reader_010',
       'author_unique_reader_050',
       'author_unique_reader_100',
       'author_unique_reader_500',
       'author_favorite_010',
       'author_favorite_050',
       'author_favorite_100',
       'author_comment_010',
       'author_comment_050',
       'author_seed_received_001',
       'author_seed_received_010',
       'author_seed_received_050',
       'author_discovered_plus2_001',
       'author_discovered_plus3_001',
       'author_chars_1m',
       'author_completed_010',
       'author_unique_reader_1000',
       'author_favorite_500',
       'author_discovered_plus2_005'
     );

    update public.scout_badge_runtime_config
       set rule_version='beta-2026-09-21',
           updated_at=now()
     where id=1;

    alter table public.scout_badge_definitions
      drop column if exists condition_config,
      drop column if exists metric_key;
    alter table public.scout_badge_runtime_config
      drop column if exists reader_badges_activated_at,
      drop column if exists badge_settings;
  else
    update public.scout_badge_definitions
       set enabled=false,
           sort_order=3000 + coalesce((metadata->>'spec_no')::integer, sort_order),
           updated_at=now()
     where badge_id like 'reader_%';

    update public.scout_badge_runtime_config
       set rule_version='beta-2026-09-21-rollback-preserved',
           updated_at=now()
     where id=1;
  end if;
end
$$;

commit;