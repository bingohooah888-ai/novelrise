-- NOVELIGHT: keep public.profiles in one-to-one lifecycle sync with auth.users.
--
-- Historical Production profiles predate a foreign key on profiles.id. That
-- allows Auth smoke/test cleanup to delete auth.users rows while leaving an
-- orphan profile behind. The orphan can then fail Production readiness checks.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915173000-profile-auth-user-integrity'));

do $migration$
declare
  v_unsafe_orphans bigint;
  v_existing_fk record;
begin
  if to_regclass('public.profiles') is null or to_regclass('auth.users') is null then
    raise exception 'public.profiles and auth.users are required';
  end if;

  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.user_lifecycle') is null
     or to_regclass('public.user_acquisition') is null
     or to_regclass('public.billing_checkout_attempts') is null
     or to_regclass('public.novel_comments') is null then
    raise exception 'required NOVELIGHT dependent tables are missing';
  end if;

  -- Never delete an orphan profile that still owns product or lifecycle data.
  select count(*)
    into v_unsafe_orphans
    from public.profiles p
   where not exists (select 1 from auth.users u where u.id = p.id)
     and (
       exists (select 1 from public.novels n where n.user_id = p.id)
       or exists (select 1 from public.episodes e where e.user_id = p.id)
       or exists (select 1 from public.favorites f where f.user_id = p.id)
       or exists (select 1 from public.user_lifecycle l where l.user_id = p.id)
       or exists (select 1 from public.user_acquisition a where a.user_id = p.id)
       or exists (select 1 from public.billing_checkout_attempts b where b.user_id = p.id)
       or exists (select 1 from public.novel_comments c where c.user_id = p.id)
     );

  if v_unsafe_orphans <> 0 then
    raise exception 'Found % orphan profile(s) with dependent data; stop for manual review', v_unsafe_orphans;
  end if;

  -- An existing profiles -> auth.users FK with a different delete action is
  -- drift. Fail closed instead of silently replacing it.
  select c.conname, c.confdeltype, c.convalidated
    into v_existing_fk
    from pg_constraint c
   where c.conrelid = 'public.profiles'::regclass
     and c.contype = 'f'
     and c.confrelid = 'auth.users'::regclass
   limit 1;

  if found and (v_existing_fk.confdeltype <> 'c' or v_existing_fk.conname <> 'profiles_id_auth_user_fkey') then
    raise exception 'Unexpected profiles -> auth.users foreign key %; inspect drift before applying', v_existing_fk.conname;
  end if;

  -- Current known orphan rows are test/smoke residue with no dependent data.
  delete from public.profiles p
   where not exists (select 1 from auth.users u where u.id = p.id);

  if not found then
    alter table public.profiles
      add constraint profiles_id_auth_user_fkey
      foreign key (id)
      references auth.users(id)
      on delete cascade
      not valid;
  end if;

  alter table public.profiles
    validate constraint profiles_id_auth_user_fkey;
end
$migration$;

commit;
