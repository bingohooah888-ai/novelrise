\set ON_ERROR_STOP on

select public.test_assert(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'first_published_at'
  ),
  'novels has first_published_at'
);

select public.test_assert(
  not exists (
    select 1 from public.novels
    where status = 'published' and first_published_at is null
  ),
  'all currently published works have an authoritative first publication time'
);
