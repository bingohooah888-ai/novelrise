\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.novels') is null then
    raise exception 'profiles, favorites, and novels must exist';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'stripe_customer_id'
  ) then
    raise exception 'profiles.stripe_customer_id must exist before hardening';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'title'
  ) then
    raise exception 'novels discovery columns must exist before hardening';
  end if;
end
$$;
