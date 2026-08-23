\set ON_ERROR_STOP on

select public.test_assert(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_exposure_conversions'
      and column_name = 'episode_number_snapshot'
      and data_type = 'integer'
  ),
  'episode_number_snapshot must exist after migration'
);

select public.test_assert(
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_conversion_once'
  ),
  'legacy exposure/event unique constraint must be removed'
);

select public.test_assert(
  to_regclass('public.novel_exposure_conversion_detail_once_idx') is not null
  and to_regclass('public.novel_exposure_conversion_episode_once_idx') is not null
  and to_regclass('public.novel_exposure_conversion_favorite_once_idx') is not null,
  'retention unique indexes must exist'
);

select public.test_assert(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.novel_exposure_conversions'::regclass
      and conname = 'novel_exposure_conversions_event_type_check'
      and pg_get_constraintdef(oid) like '%favorite_added%'
  ),
  'event type check must allow attributed favorite events'
);

select public.test_assert(
  has_function_privilege(
    'anon',
    'public.record_novel_exposure_conversion(text,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.record_novel_exposure_conversion(text,text,text,text)',
    'EXECUTE'
  ),
  'reader conversion recorder must remain callable by anon and authenticated users'
);

select public.test_assert(
  not has_function_privilege(
    'anon',
    'public.novelight_author_exposure_funnel(integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.novelight_author_exposure_funnel(integer)',
    'EXECUTE'
  ),
  'author funnel aggregate must remain authenticated-only'
);

select public.test_assert(
  pg_get_function_result(
    'public.novelight_author_exposure_funnel(integer)'::regprocedure
  ) like '%first_episode_reads_10s%'
  and pg_get_function_result(
    'public.novelight_author_exposure_funnel(integer)'::regprocedure
  ) like '%continued_to_episode_2%'
  and pg_get_function_result(
    'public.novelight_author_exposure_funnel(integer)'::regprocedure
  ) like '%favorites%'
  and pg_get_function_result(
    'public.novelight_author_exposure_funnel(integer)'::regprocedure
  ) like '%favorite_rate_pct%',
  'author funnel must expose retention and favorite aggregates'
);

select public.test_assert(
  not has_table_privilege('anon', 'public.novel_exposure_conversions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.novel_exposure_conversions', 'SELECT'),
  'raw conversion ledger must remain hidden from clients'
);

select 'PASS: exposure funnel retention postcheck' as result;
