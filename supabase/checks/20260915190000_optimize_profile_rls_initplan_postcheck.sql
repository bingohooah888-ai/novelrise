-- NOVELIGHT profile RLS initplan postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_insert_check text;
  v_update_using text;
  v_update_check text;
begin
  select with_check into v_insert_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Users can insert own profile'
    and cmd = 'INSERT';

  select qual, with_check into v_update_using, v_update_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Users can update own profile'
    and cmd = 'UPDATE';

  if v_insert_check is null
     or position('SELECT auth.uid()' in v_insert_check) = 0 then
    raise exception 'Insert profile policy is not using an init-plan auth.uid() expression';
  end if;

  if v_update_using is null
     or position('SELECT auth.uid()' in v_update_using) = 0
     or v_update_check is null
     or position('SELECT auth.uid()' in v_update_check) = 0 then
    raise exception 'Update profile policy is not using init-plan auth.uid() expressions';
  end if;
end
$$;

select 'PASS: profile RLS initplan postcheck' as result;
