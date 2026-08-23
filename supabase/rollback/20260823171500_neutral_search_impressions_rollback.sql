begin;
select pg_advisory_xact_lock(hashtext('novelrise:20260823171500'));

do $$
begin
  if exists (select 1 from public.novel_exposure_events where surface = 'search_results') then
    raise exception 'search_results data exists; export/review it before rollback';
  end if;
end
$$;

drop function if exists public.record_neutral_search_impressions(text[], text);
alter table public.novel_exposure_events drop constraint if exists novel_exposure_events_surface_check;
alter table public.novel_exposure_events add constraint novel_exposure_events_surface_check
  check (surface in ('home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended'));
commit;
