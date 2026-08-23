\set ON_ERROR_STOP on

select public.test_assert(
  to_regclass('public.novel_exposure_conversions') is not null,
  'exposure conversion ledger must exist before retention migration'
);

select public.test_assert(
  to_regprocedure('public.record_novel_exposure_conversion(text,text,text,text)') is not null,
  'record_novel_exposure_conversion must exist before retention migration'
);

select public.test_assert(
  to_regprocedure('public.novelight_author_exposure_funnel(integer)') is not null,
  'author exposure funnel must exist before retention migration'
);

select public.test_assert(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_exposure_conversions'
      and column_name = 'episode_number_snapshot'
  ),
  'episode_number_snapshot must not already exist'
);

select public.test_assert(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_conversion_once'
      and contype = 'u'
  ),
  'legacy exposure/event unique constraint must exist'
);

select public.test_assert(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_conversions_event_type_check'
      and contype = 'c'
  ),
  'legacy event type check constraint must exist'
);

select public.test_assert(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_episode_requirement'
      and contype = 'c'
  ),
  'legacy episode requirement check constraint must exist'
);

select public.test_assert(
  not exists (
    select 1
    from public.novel_exposure_conversions
    where event_type not in ('detail_open', 'episode_read_10s')
  ),
  'unexpected conversion event types exist before migration'
);

select public.test_assert(
  to_regclass('public.novel_exposure_conversion_detail_once_idx') is null
  and to_regclass('public.novel_exposure_conversion_episode_once_idx') is null
  and to_regclass('public.novel_exposure_conversion_favorite_once_idx') is null,
  'retention unique indexes must not already exist'
);

select 'PASS: exposure funnel retention precheck' as result;
