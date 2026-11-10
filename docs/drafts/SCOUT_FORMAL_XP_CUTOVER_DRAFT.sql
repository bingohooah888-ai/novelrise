-- SCOUT LEVEL 100 formal-release ONLY: DRAFT, DO NOT APPLY to Staging beta or Production.
-- Prerequisite: separately approved formal release cutover, formal state initialized,
-- beta-to-formal migration verified, and one-time Level reward source switched.
-- The existing beta trigger remains active in every deployed environment until then.
-- This file is deliberately outside supabase/migrations.

begin;

-- Future release: remove the *beta XP cap and discovery exclusion* only at launch.
-- The existing trigger scout_xp_beta_level_cap remains attached, using this
-- replacement function. The historical beta record/ledger is never rewritten.
create or replace function public.novelight_cap_scout_xp_beta()
returns trigger
language plpgsql security definer set search_path = ''
as $formal_cutover$
begin
  -- Negative adjustment policy is unresolved: do not silently alter old ledger semantics.
  return new;
end
$formal_cutover$;

-- No new XP ledger, no duplicate XP source and no new scheduler.
-- Reuse the existing formal private apply_scout_xp() row lock and XP claim.
create or replace function novelight_formal_private.on_scout_xp_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $formal_capture$
declare
  v_result jsonb;
begin
  -- Historical accounts must be initialized first. An uninitialized new user
  -- retains the XP ledger entry for explicit catch-up; do not auto-assign a level.
  if not exists (
    select 1 from novelight_formal_private.scout_level_state s
    where s.user_id = new.user_id
  ) then
    return new;
  end if;
  v_result := novelight_formal_private.apply_scout_xp(new.id);
  -- review_due_first / closed_or_pre_release_window / Lv100 surplus remain
  -- unclaimed in scout_xp_ledger. The existing service can retry after
  -- completing chronological 30-day reviews. No implicit auto-review here.
  if v_result->>'status' not in (
    'applied',
    'already_applied',
    'review_due_first',
    'closed_or_pre_release_window',
    'level_100_surplus_policy_pending',
    'adjustment_policy_pending'
  ) then
    raise exception 'Unexpected formal XP application status: %',v_result->>'status';
  end if;
  return new;
end
$formal_capture$;

revoke all on function novelight_formal_private.on_scout_xp_insert()
  from public, anon, authenticated;
grant execute on function novelight_formal_private.on_scout_xp_insert()
  to service_role;

-- This trigger MUST be created only during the separately approved release
-- transaction: enabling it now would change the existing beta XP behavior.
create trigger scout_formal_xp_after_insert
after insert on public.scout_xp_ledger
for each row
execute function novelight_formal_private.on_scout_xp_insert();

-- The legacy scout_xp_level_up_points trigger currently derives rewards
-- from lifetime beta XP, not current/formal level state. The OWNER-approved
-- first-time formal Level reward connection is a separate, UNFINISHED step.
-- This Draft is NOT a complete release migration and MUST NOT be deployed
-- without a completed replacement for that existing reward writer.
commit;
