\set ON_ERROR_STOP on

select public.test_assert(to_regclass('public.novel_exposure_rules') is not null, 'exposure rules must exist');
select public.test_assert(to_regclass('public.novel_exposure_events') is not null, 'exposure events must exist');
select public.test_assert(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'novel_exposure_events' and column_name = 'allocation_reason'
  ),
  'exposure v2 must not already be installed'
);
