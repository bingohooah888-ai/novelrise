\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is missing';
  end if;

  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing';
  end if;

  if not exists (
    select 1
      from pg_attribute
     where attrelid = 'public.profiles'::regclass
       and attname = 'display_name'
       and not attisdropped
  ) then
    raise exception 'public.profiles.display_name is missing';
  end if;

  if not exists (
    select 1
      from pg_attribute
     where attrelid = 'auth.users'::regclass
       and attname = 'raw_user_meta_data'
       and not attisdropped
  ) then
    raise exception 'auth.users.raw_user_meta_data is missing';
  end if;
end
$$;
