-- NOVELIGHT profile RLS initplan precheck.
\set ON_ERROR_STOP on

do $$
declare
  v_insert_count integer;
  v_update_count integer;
begin
  select count(*) into v_insert_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Users can insert own profile'
    and cmd = 'INSERT'
    and roles = '{authenticated}'::name[];

  select count(*) into v_update_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Users can update own profile'
    and cmd = 'UPDATE'
    and roles = '{authenticated}'::name[];

  if v_insert_count <> 1 or v_update_count <> 1 then
    raise exception 'Expected profile insert/update policies are missing or drifted';
  end if;
end
$$;

select 'PASS: profile RLS initplan precheck' as result;
