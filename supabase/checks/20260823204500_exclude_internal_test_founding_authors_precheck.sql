\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.founding_authors') is null then
    raise exception 'founding_authors prerequisite is missing';
  end if;

  if to_regprocedure('public.assign_founding_author()') is null then
    raise exception 'assign_founding_author prerequisite is missing';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'profiles prerequisite is missing';
  end if;

  if to_regclass('public.founding_author_exclusions') is not null
     or to_regclass('public.founding_author_exclusion_audit') is not null then
    raise exception 'Founding exclusion objects already exist';
  end if;
end
$$;
