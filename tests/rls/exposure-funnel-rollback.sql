\set ON_ERROR_STOP on

select public.test_assert(
  to_regclass('public.novel_exposure_conversions') is null,
  'novel_exposure_conversions must be removed by rollback'
);

select public.test_assert(
  to_regprocedure('public.record_novel_exposure_conversion(text,text,text,text)') is null,
  'record_novel_exposure_conversion must be removed by rollback'
);

select public.test_assert(
  to_regprocedure('public.novelight_author_exposure_funnel(integer)') is null,
  'novelight_author_exposure_funnel must be removed by rollback'
);

select public.test_assert(
  to_regclass('public.novel_exposure_events') is not null,
  'funnel rollback must preserve the underlying exposure ledger'
);

select 'PASS: exposure funnel rollback' as result;
