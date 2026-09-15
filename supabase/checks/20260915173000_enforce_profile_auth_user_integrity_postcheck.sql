-- NOVELIGHT profile/Auth user integrity postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_constraint record;
  v_orphans bigint;
begin
  select c.conname, c.confdeltype, c.convalidated
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.profiles'::regclass
     and c.contype = 'f'
     and c.confrelid = 'auth.users'::regclass
     and c.conname = 'profiles_id_auth_user_fkey';

  if not found then
    raise exception 'profiles_id_auth_user_fkey is missing';
  end if;

  if v_constraint.confdeltype <> 'c' then
    raise exception 'profiles_id_auth_user_fkey must use ON DELETE CASCADE';
  end if;

  if v_constraint.convalidated is distinct from true then
    raise exception 'profiles_id_auth_user_fkey must be validated';
  end if;

  select count(*)
    into v_orphans
    from public.profiles p
   where not exists (select 1 from auth.users u where u.id = p.id);

  if v_orphans <> 0 then
    raise exception 'Found % orphan profile(s) after migration', v_orphans;
  end if;
end
$$;

select 'PASS: profile/Auth user integrity postcheck' as result;
