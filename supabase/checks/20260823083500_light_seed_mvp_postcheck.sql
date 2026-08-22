-- NOVELIGHT LIGHT SEED MVP postcheck.

\set ON_ERROR_STOP on

do $$
declare
  rls_enabled boolean;
begin
  if to_regclass('public.light_seeds') is null then
    raise exception 'public.light_seeds was not created';
  end if;

  if to_regclass('public.light_seed_rules') is null then
    raise exception 'public.light_seed_rules was not created';
  end if;

  select c.relrowsecurity
  into rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'light_seeds';

  if not coalesce(rls_enabled, false) then
    raise exception 'RLS must be enabled on public.light_seeds';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'light_seeds'
      and policyname = 'light_seeds_select_own_history'
      and cmd = 'SELECT'
  ) then
    raise exception 'LIGHT SEED own-history SELECT policy is missing';
  end if;

  if has_table_privilege('authenticated', 'public.light_seeds', 'INSERT')
     or has_table_privilege('authenticated', 'public.light_seeds', 'UPDATE')
     or has_table_privilege('authenticated', 'public.light_seeds', 'DELETE') then
    raise exception 'Authenticated users must not write light_seeds directly';
  end if;

  if not has_table_privilege('authenticated', 'public.light_seeds', 'SELECT') then
    raise exception 'Authenticated users need SELECT on their RLS-filtered seed history';
  end if;

  if has_table_privilege('authenticated', 'public.light_seed_rules', 'SELECT')
     or has_table_privilege('anon', 'public.light_seed_rules', 'SELECT') then
    raise exception 'LIGHT SEED rules must not be directly exposed';
  end if;

  if to_regprocedure('public.light_seed_status(text)') is null then
    raise exception 'public.light_seed_status(text) is missing';
  end if;

  if to_regprocedure('public.plant_light_seed(text)') is null then
    raise exception 'public.plant_light_seed(text) is missing';
  end if;

  if not has_function_privilege('authenticated', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'authenticated must be able to execute plant_light_seed';
  end if;

  if has_function_privilege('anon', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'anon must not be able to execute plant_light_seed';
  end if;

  if not has_function_privilege('authenticated', 'public.light_seed_status(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.light_seed_status(text)', 'EXECUTE') then
    raise exception 'status function must be readable by anon and authenticated';
  end if;

  if not exists (
    select 1
    from public.light_seed_rules
    where id = 1
      and rule_version = 'beta-v1'
      and monthly_limit = 10
      and max_pv = 1000
      and max_favorites = 50
  ) then
    raise exception 'Expected beta-v1 LIGHT SEED rule row is missing';
  end if;
end
$$;

select 'PASS: LIGHT SEED postcheck' as result;
