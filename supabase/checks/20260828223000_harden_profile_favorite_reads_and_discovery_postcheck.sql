\set ON_ERROR_STOP on

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'profiles RLS must be enabled';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.favorites'::regclass) then
    raise exception 'favorites RLS must be enabled';
  end if;

  if has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'anon must not have direct SELECT on profiles';
  end if;

  if has_table_privilege('anon', 'public.favorites', 'SELECT') then
    raise exception 'anon must not have direct SELECT on favorites';
  end if;

  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'authenticated must retain own-profile SELECT capability';
  end if;

  if not has_table_privilege('authenticated', 'public.favorites', 'SELECT') then
    raise exception 'authenticated must retain own-favorite SELECT capability';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'novelight_profiles_select_own'
      and cmd = 'SELECT'
  ) then
    raise exception 'profiles own-only SELECT policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'favorites'
      and policyname = 'novelight_favorites_select_own'
      and cmd = 'SELECT'
  ) then
    raise exception 'favorites own-only SELECT policy is missing';
  end if;

  if to_regprocedure('public.novelight_public_profile(uuid)') is null
     or to_regprocedure('public.novelight_favorite_count(text)') is null
     or to_regprocedure('public.novelight_neutral_search(text,text,text,integer,integer)') is null
     or to_regprocedure('public.novelight_ranking_feed(text,integer)') is null then
    raise exception 'one or more hardened public RPCs are missing';
  end if;
end
$$;
