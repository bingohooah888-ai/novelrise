-- Guarded rollback for 20260928061000_beta_rank_discovery_privacy.sql.
-- First apply 20260928061100_beta_rank_discovery_rpc_guard_rollback.sql.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928061000:rollback'));

do $$
begin
  if to_regprocedure('public.novelight_set_scout_badge_visibility_rank_internal_20260928(text,boolean)') is not null then
    raise exception 'Rollback 20260928061100 RPC guard before 20260928061000';
  end if;

  if to_regprocedure('public.novelight_process_seed_discovery_rank_internal_20260928(uuid)') is null
     or to_regprocedure('public.novelight_award_discovery_points_rank_internal_20260928()') is null
     or to_regprocedure('public.novelight_cap_scout_xp_beta_rank_internal_20260928()') is null
     or to_regprocedure('public.novelight_award_level_up_points_rank_internal_20260928()') is null
     or to_regprocedure('public.novelight_reader_badge_metrics_rank_internal_20260928(uuid)') is null
     or to_regprocedure('public.novelight_author_badge_metrics_rank_internal_20260928(uuid)') is null
     or to_regprocedure('public.novelight_scout_record_summary_rank_internal_20260928()') is null
     or to_regprocedure('public.novelight_scout_point_history_rank_internal_20260928(integer)') is null
     or to_regprocedure('public.novelight_scout_recent_activity_rank_internal_20260928(integer)') is null
     or to_regprocedure('public.novelight_scout_discoveries_rank_internal_20260928(integer)') is null then
    raise exception 'Original SCOUT function backups are incomplete';
  end if;
end
$$;

-- Restore direct trigger functions and rebind the triggers to their original OIDs.
drop trigger if exists scout_event_discovery_points on public.scout_event_ledger;
drop function public.novelight_award_discovery_points();
alter function public.novelight_award_discovery_points_rank_internal_20260928()
  rename to novelight_award_discovery_points;
create trigger scout_event_discovery_points
after insert on public.scout_event_ledger
for each row execute function public.novelight_award_discovery_points();

drop trigger if exists scout_xp_beta_level_cap on public.scout_xp_ledger;
drop function public.novelight_cap_scout_xp_beta();
alter function public.novelight_cap_scout_xp_beta_rank_internal_20260928()
  rename to novelight_cap_scout_xp_beta;
create trigger scout_xp_beta_level_cap
before insert on public.scout_xp_ledger
for each row execute function public.novelight_cap_scout_xp_beta();

drop trigger if exists scout_xp_level_up_points on public.scout_xp_ledger;
drop function public.novelight_award_level_up_points();
alter function public.novelight_award_level_up_points_rank_internal_20260928()
  rename to novelight_award_level_up_points;
create trigger scout_xp_level_up_points
after insert on public.scout_xp_ledger
for each row execute function public.novelight_award_level_up_points();

-- Restore the original discovery processor and metric/RPC implementations.
drop function public.novelight_process_seed_discovery(uuid);
alter function public.novelight_process_seed_discovery_rank_internal_20260928(uuid)
  rename to novelight_process_seed_discovery;

drop function public.novelight_reader_badge_metrics(uuid);
alter function public.novelight_reader_badge_metrics_rank_internal_20260928(uuid)
  rename to novelight_reader_badge_metrics;

drop function public.novelight_author_badge_metrics(uuid);
alter function public.novelight_author_badge_metrics_rank_internal_20260928(uuid)
  rename to novelight_author_badge_metrics;

drop function public.novelight_scout_record_summary();
alter function public.novelight_scout_record_summary_rank_internal_20260928()
  rename to novelight_scout_record_summary;

drop function public.novelight_scout_point_history(integer);
alter function public.novelight_scout_point_history_rank_internal_20260928(integer)
  rename to novelight_scout_point_history;

drop function public.novelight_scout_recent_activity(integer);
alter function public.novelight_scout_recent_activity_rank_internal_20260928(integer)
  rename to novelight_scout_recent_activity;

drop function public.novelight_scout_discoveries(integer);
alter function public.novelight_scout_discoveries_rank_internal_20260928(integer)
  rename to novelight_scout_discoveries;

-- Restore badge definition activation state exactly as it was before the beta gate.
update public.scout_badge_definitions d
   set enabled = case
         when d.metadata->>'beta_rank_previous_enabled' = 'true' then true
         when d.metadata->>'beta_rank_previous_enabled' = 'false' then false
         else d.enabled
       end,
       metadata = coalesce(d.metadata, '{}'::jsonb)
         - 'beta_rank_discovery_hidden'
         - 'beta_rank_previous_enabled',
       updated_at = now()
 where d.metadata->>'beta_rank_discovery_hidden' = 'true';

-- Restore a previously equipped title only when doing so cannot violate the
-- single-equipped-title constraint. Progress/earned evidence was never deleted.
update public.user_scout_badges b
   set is_public = case
         when b.metadata->>'beta_rank_previous_is_public' = 'true'
          and b.status = 'earned'
          and not exists (
            select 1
              from public.user_scout_badges other
             where other.user_id = b.user_id
               and other.badge_id <> b.badge_id
               and other.status = 'earned'
               and other.is_public
          )
           then true
         else false
       end,
       metadata = coalesce(b.metadata, '{}'::jsonb)
         - 'beta_rank_previous_is_public'
         - 'beta_rank_discovery_hidden',
       updated_at = now()
 where b.metadata->>'beta_rank_discovery_hidden' = 'true';

drop function public.novelight_beta_rank_point_is_hidden(text, uuid, jsonb);

commit;
