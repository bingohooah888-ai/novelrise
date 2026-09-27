-- NOVELIGHT beta SCOUT RECORD: close compatibility/back-up RPC paths that could
-- otherwise expose private work-Rank discovery after the 20260928061000 policy migration.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928061100'));

do $$
begin
  if to_regprocedure('public.novelight_scout_discoveries_rank_internal_20260928(integer)') is null
     or to_regprocedure('public.novelight_scout_recent_activity_rank_internal_20260928(integer)') is null
     or to_regprocedure('public.novelight_scout_record_summary_rank_internal_20260928()') is null
     or to_regprocedure('public.novelight_scout_point_history_rank_internal_20260928(integer)') is null then
    raise exception 'Beta Rank privacy function backups are required';
  end if;

  if to_regprocedure('public.novelight_set_scout_badge_visibility_rank_internal_20260928(text,boolean)') is not null then
    raise exception 'Beta Rank visibility guard already applied or requires reconciliation';
  end if;
end
$$;

-- Renamed RPCs retain their old grants in PostgreSQL. They are implementation
-- backups only and must never remain callable by browser roles during beta.
revoke all on function public.novelight_scout_record_summary_rank_internal_20260928()
  from public, anon, authenticated;
revoke all on function public.novelight_scout_point_history_rank_internal_20260928(integer)
  from public, anon, authenticated;
revoke all on function public.novelight_scout_recent_activity_rank_internal_20260928(integer)
  from public, anon, authenticated;
revoke all on function public.novelight_scout_discoveries_rank_internal_20260928(integer)
  from public, anon, authenticated;

-- Prevent a caller who remembers a previously earned Rank title ID from equipping
-- it directly while its definition is disabled for beta.
alter function public.novelight_set_scout_badge_visibility(text, boolean)
  rename to novelight_set_scout_badge_visibility_rank_internal_20260928;
revoke all on function public.novelight_set_scout_badge_visibility_rank_internal_20260928(text, boolean)
  from public, anon, authenticated;

create or replace function public.novelight_set_scout_badge_visibility(
  p_badge_id text,
  p_is_public boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_is_public, false)
     and not exists (
       select 1
         from public.scout_badge_definitions d
        where d.badge_id = p_badge_id
          and d.enabled
     ) then
    return false;
  end if;

  return public.novelight_set_scout_badge_visibility_rank_internal_20260928(
    p_badge_id,
    p_is_public
  );
end
$$;

revoke all on function public.novelight_set_scout_badge_visibility(text, boolean)
  from public, anon;
grant execute on function public.novelight_set_scout_badge_visibility(text, boolean)
  to authenticated;

comment on function public.novelight_set_scout_badge_visibility(text, boolean) is
  'Beta guard: disabled work-Rank discovery titles cannot be equipped.';

commit;
