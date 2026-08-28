\set ON_ERROR_STOP on

select public.test_assert(
  not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
  ),
  'profile RLS must return to the fixture baseline after rollback'
);

select public.test_assert(
  not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'favorites'
  ),
  'favorite RLS must return to the fixture baseline after rollback'
);

select public.test_assert(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'profile SELECT grant must be restored after rollback'
);

select public.test_assert(
  not has_table_privilege('authenticated', 'public.favorites', 'SELECT'),
  'favorite SELECT grant must return to the fixture baseline after rollback'
);

select public.test_assert(
  not exists (
    select 1
    from novelrise_migration_backup.table_rls_state
    where migration_id = '20260828223000'
  ),
  'privacy rollback must clean up its RLS-state backup rows'
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

select public.test_assert(
  (select count(*) from public.profiles) > 1,
  'rollback must restore the pre-hardening profile visibility baseline'
);

reset role;

select 'PASS: privacy hardening rollback restored RLS and grants' as result;
