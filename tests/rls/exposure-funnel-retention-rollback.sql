\set ON_ERROR_STOP on

select public.test_assert(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_exposure_conversions'
      and column_name = 'episode_number_snapshot'
  ),
  'retention rollback must remove episode_number_snapshot'
);

select public.test_assert(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_conversion_once'
      and contype = 'u'
  ),
  'retention rollback must restore legacy exposure/event uniqueness'
);

select public.test_assert(
  to_regclass('public.novel_exposure_conversion_detail_once_idx') is null
  and to_regclass('public.novel_exposure_conversion_episode_once_idx') is null
  and to_regclass('public.novel_exposure_conversion_favorite_once_idx') is null,
  'retention rollback must remove partial unique indexes'
);

select public.test_assert(
  pg_get_function_result(
    'public.novelight_author_exposure_funnel(integer)'::regprocedure
  ) not like '%continued_to_episode_2%'
  and pg_get_function_result(
    'public.novelight_author_exposure_funnel(integer)'::regprocedure
  ) not like '%favorite_rate_pct%',
  'retention rollback must restore the previous author funnel return shape'
);

select public.test_assert(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_conversions_event_type_check'
      and pg_get_constraintdef(oid) not like '%favorite_added%'
  ),
  'retention rollback must restore legacy conversion event types'
);

select 'PASS: exposure funnel retention rollback' as result;
