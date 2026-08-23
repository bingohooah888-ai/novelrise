-- Roll back exposure v2 while leaving v1 RPCs untouched.
-- If plan-extra impressions already exist, stop instead of silently relabeling
-- paid exposure as general exposure.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823171000'));

do $$
begin
  if exists (
    select 1 from public.novel_exposure_events where surface = 'home_plan_extra'
  ) then
    raise exception 'home_plan_extra data exists; export/review it before rolling back exposure v2';
  end if;
end
$$;

drop function if exists public.novelight_author_exposure_funnel_v2(integer);
drop function if exists public.record_novel_impressions_v2(text, text[], text);
drop function if exists public.novelight_plan_extra_feed(integer, text[], text);
drop function if exists public.novelight_discovery_feed_v2(text, integer, text, text, text);

drop index if exists public.novel_exposure_reason_recent_idx;

alter table public.novel_exposure_events
  drop constraint if exists novel_exposure_events_surface_check;

alter table public.novel_exposure_events
  add constraint novel_exposure_events_surface_check
  check (surface in ('home_discovery', 'home_premium_slot', 'search_recommended'));

alter table public.novel_exposure_events
  drop column if exists allocation_reason;

alter table public.novel_exposure_rules
  drop column if exists premium_plan_extra_weight,
  drop column if exists initial_exposure_window_days,
  drop column if exists initial_exposure_target;

commit;
