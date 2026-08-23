\set ON_ERROR_STOP on

do $$
declare
  v_function text;
begin
  if to_regclass('public.founding_author_exclusions') is null
     or to_regclass('public.founding_author_exclusion_audit') is null then
    raise exception 'Founding exclusion objects are missing';
  end if;

  if has_table_privilege('anon', 'public.founding_author_exclusions', 'SELECT')
     or has_table_privilege('authenticated', 'public.founding_author_exclusions', 'SELECT')
     or has_table_privilege('anon', 'public.founding_author_exclusion_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.founding_author_exclusion_audit', 'SELECT') then
    raise exception 'Founding exclusion operator tables must remain private';
  end if;

  if exists (
    select 1
      from public.founding_authors f
      join public.founding_author_exclusions e on e.user_id = f.author_id
  ) then
    raise exception 'Excluded internal test account still owns a Founding Author slot';
  end if;

  if exists (
    select 1
      from public.profiles p
     where btrim(coalesce(p.display_name, '')) in ('テスト作者', 'テスト君', '登録テスト')
       and not exists (
         select 1
           from public.founding_author_exclusions e
          where e.user_id = p.id
       )
  ) then
    raise exception 'Known pre-beta test profile was not resolved to an exclusion ID';
  end if;

  select pg_get_functiondef('public.assign_founding_author()'::regprocedure)
    into v_function;

  if position('founding_author_exclusions' in v_function) = 0 then
    raise exception 'Founding assignment function does not enforce exclusions';
  end if;
end
$$;
