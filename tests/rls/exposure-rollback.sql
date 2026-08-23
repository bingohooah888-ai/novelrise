\set ON_ERROR_STOP on

select public.test_assert(
  to_regclass('public.novel_exposure_events') is null,
  'novel_exposure_events must be removed by rollback'
);

select public.test_assert(
  to_regclass('public.novel_exposure_rules') is null,
  'novel_exposure_rules must be removed by rollback'
);

select public.test_assert(
  to_regprocedure('public.novelight_discovery_feed(text,integer,text,text,text)') is null,
  'novelight_discovery_feed must be removed by rollback'
);

select public.test_assert(
  to_regprocedure('public.record_novel_impressions(text,text[],text)') is null,
  'record_novel_impressions must be removed by rollback'
);

select 'PASS: exposure allocation rollback' as result;
