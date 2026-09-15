-- NOVELIGHT profile/Auth user integrity precheck.
\set ON_ERROR_STOP on

do $$
declare
  v_unsafe_orphans bigint;
begin
  if to_regclass('public.profiles') is null or to_regclass('auth.users') is null then
    raise exception 'public.profiles and auth.users are required';
  end if;

  if exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.profiles'::regclass
       and c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
  ) then
    raise exception 'profiles already has an auth.users foreign key; inspect drift before applying';
  end if;

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
    raise exception 'Found % orphan profile(s) with dependent data; manual review required', v_unsafe_orphans;
  end if;
end
$$;

select count(*)::bigint as safe_orphan_profiles_to_remove
  from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);

select 'PASS: profile/Auth user integrity precheck' as result;
