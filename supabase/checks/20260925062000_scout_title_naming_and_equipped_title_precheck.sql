-- Precheck for SCOUT title naming + equipped-title migration.
do $$
declare
  v_reader integer;
  v_author integer;
  v_limited integer;
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null then
    raise exception 'SCOUT badge tables are missing';
  end if;

  select count(*) into v_reader
  from public.scout_badge_definitions
  where badge_category = 'reader' and enabled;

  select count(*) into v_author
  from public.scout_badge_definitions
  where badge_category = 'author' and enabled;

  select count(*) into v_limited
  from public.scout_badge_definitions
  where badge_category = 'limited' and enabled;

  if v_reader <> 100 or v_author <> 40 or v_limited < 2 then
    raise exception 'SCOUT title catalog is not at the expected canonical size';
  end if;
end
$$;
