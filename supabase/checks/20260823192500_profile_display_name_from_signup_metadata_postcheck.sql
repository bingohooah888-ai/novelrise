\set ON_ERROR_STOP on

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'novelight_profiles_fill_signup_display_name'
       and not tgisinternal
  ) then
    raise exception 'signup display-name trigger is missing';
  end if;

  if exists (
    select 1
      from public.profiles p
      join auth.users u on u.id = p.id
     where (p.display_name is null or btrim(p.display_name) = '')
       and nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') is not null
  ) then
    raise exception 'a profile still has a blank display name despite signup metadata';
  end if;
end
$$;
