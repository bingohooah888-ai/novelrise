-- NOVELIGHT trusted public impression receipts precheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_allocation_receipts') is null then
    raise exception 'public.novel_allocation_receipts is required';
  end if;
  if to_regclass('public.novel_exposure_events') is null then
    raise exception 'public.novel_exposure_events is required';
  end if;
  if to_regclass('public.novel_exposure_rules') is null then
    raise exception 'public.novel_exposure_rules is required';
  end if;
  if to_regclass('public.novels') is null or to_regclass('public.profiles') is null then
    raise exception 'public.novels and public.profiles are required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_allocation_receipts'
      and column_name = 'viewer_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  ) then
    raise exception 'novel_allocation_receipts.viewer_id must be the pre-migration NOT NULL uuid column';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_allocation_receipts'
      and column_name = 'viewer_key'
  ) then
    raise exception 'novel_allocation_receipts.viewer_key already exists; review partial/drifted state';
  end if;

  if to_regprocedure('public.novelight_discovery_feed_v2(text,integer,text,text,text)') is null
     or to_regprocedure('public.novelight_plan_extra_feed(integer,text[],text)') is null
     or to_regprocedure('public.novelight_neutral_search(text,text,text,integer,integer)') is null
     or to_regprocedure('public.novelight_light_seed_feed(integer,integer)') is null
     or to_regprocedure('public.novelight_beta_rank_discovery_feed(text,integer,text)') is null
     or to_regprocedure('public.record_novel_impressions(text,text[],text)') is null
     or to_regprocedure('public.record_novel_impressions_v2(text,text[],text)') is null then
    raise exception 'one or more trusted public impression prerequisites are missing';
  end if;

  if to_regprocedure('public.novelight_trusted_discovery_feed_v2(text,integer,text,text,text)') is not null
     or to_regprocedure('public.novelight_trusted_plan_extra_feed_v2(integer,text[],text)') is not null
     or to_regprocedure('public.novelight_issue_visible_allocation_receipts_v2(text,text[],text,integer,text)') is not null
     or to_regprocedure('public.record_trusted_allocation_receipts_v2(uuid[],text)') is not null
     or to_regprocedure('private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)') is not null
     or to_regprocedure('private.novelight_trusted_plan_extra_feed_v2_impl(integer,text[],text)') is not null
     or to_regprocedure('private.novelight_issue_visible_allocation_receipts_v2_impl(text,text[],text,integer,text)') is not null
     or to_regprocedure('private.record_trusted_allocation_receipts_v2_impl(uuid[],text)') is not null then
    raise exception 'trusted public impression v2 functions already exist; review partial/drifted state';
  end if;

  if exists (
    select 1
    from public.novel_allocation_receipts
    where viewer_id is null
       or surface not in (
         'home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended'
       )
       or allocation_reason not in (
         'balanced', 'initial_exposure', 'plan_extra', 'premium_extra'
       )
  ) then
    raise exception 'novel_allocation_receipts contains rows outside the expected pre-migration contract';
  end if;

  if exists (
    select 1
    from public.novel_exposure_events
    where surface not in (
      'home_discovery', 'home_plan_extra', 'home_premium_slot',
      'search_recommended', 'search_results'
    )
       or allocation_reason not in (
         'balanced', 'initial_exposure', 'plan_extra', 'premium_extra'
       )
  ) then
    raise exception 'novel_exposure_events contains rows outside the expected pre-migration contract';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_allocation_receipts'::regclass
      and conname = 'novel_allocation_receipts_surface_check'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_allocation_receipts'::regclass
      and conname = 'novel_allocation_receipts_allocation_reason_check'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_events'::regclass
      and conname = 'novel_exposure_events_surface_check'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_events'::regclass
      and conname = 'novel_exposure_events_allocation_reason_check'
      and convalidated
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_events'::regclass
      and conname = 'novel_exposure_hourly_dedupe'
      and convalidated
  ) then
    raise exception 'expected pre-migration exposure constraints are missing or unvalidated';
  end if;
end
$$;

select 'PASS: trusted public impression receipts precheck' as result;
