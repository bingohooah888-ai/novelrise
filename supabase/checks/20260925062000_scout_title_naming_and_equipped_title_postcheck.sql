-- Postcheck for SCOUT title naming + equipped-title migration.
do $$
declare
  v_reader integer;
  v_author integer;
  v_multi integer;
  v_default text;
begin
  select count(*) into v_reader
  from public.scout_badge_definitions
  where badge_category='reader'
    and enabled
    and metadata->>'title_name_version'='master-2026-09-24';

  select count(*) into v_author
  from public.scout_badge_definitions
  where badge_category='author'
    and enabled
    and metadata->>'title_name_version'='master-2026-09-24';

  if v_reader <> 100 or v_author <> 40 then
    raise exception 'Reader/Author title naming reconciliation is incomplete';
  end if;

  if not exists (
    select 1 from public.scout_badge_definitions
    where badge_id='reader_master_scout' and display_name='ARCHELIGHT'
  ) then
    raise exception 'ARCHELIGHT title is missing';
  end if;

  if not exists (
    select 1 from public.scout_badge_definitions
    where badge_id='author_discovered_plus2_005'
      and display_name='CONSTELLATION MAKER'
  ) then
    raise exception 'CONSTELLATION MAKER title is missing';
  end if;

  if not exists (
    select 1 from public.scout_badge_definitions
    where badge_id='limited_beta_participant' and display_name='DAWNBOUND'
  ) then
    raise exception 'DAWNBOUND limited title is missing';
  end if;

  select count(*) into v_multi
  from (
    select user_id
    from public.user_scout_badges
    where is_public and status='earned'
    group by user_id
    having count(*) > 1
  ) q;

  if v_multi <> 0 then
    raise exception 'More than one equipped title exists for a user';
  end if;

  select pg_get_expr(d.adbin, d.adrelid) into v_default
  from pg_attrdef d
  join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
  where d.adrelid='public.user_scout_badges'::regclass
    and a.attname='is_public';

  if coalesce(v_default,'') not ilike '%false%' then
    raise exception 'New title rows must default to unequipped';
  end if;

  if to_regclass('public.user_scout_single_equipped_title_idx') is null then
    raise exception 'Single equipped title unique index is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid='public.user_scout_badges'::regclass
      and tgname='scout_title_default_unequipped'
      and not tgisinternal
  ) then
    raise exception 'New-title unequipped trigger is missing';
  end if;

  if pg_get_functiondef('public.novelight_scout_point_history(integer)'::regprocedure)
       not like '%when ''badge'' then ''読者称号''%' then
    raise exception 'Scout Point visible reason still uses Badge terminology';
  end if;
end
$$;
