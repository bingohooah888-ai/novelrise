\set ON_ERROR_STOP on

do $$
declare
  v_author integer;
  v_reader integer;
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_badge_metric_state') is null
     or to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.valid_read_events') is null
     or to_regclass('public.novel_star_ratings') is null
     or to_regclass('public.novel_comments') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'SCOUT Badge System completion prerequisites are missing';
  end if;

  select count(*) filter (where badge_category='author'),
         count(*) filter (where badge_category='reader')
    into v_author, v_reader
    from public.scout_badge_definitions;

  if v_author <> 40 or v_reader <> 0 then
    raise exception 'Expected Author 40 / Reader 0 before completion, got Author % / Reader %',
      v_author, v_reader;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='scout_badge_definitions'
       and column_name in ('metric_key','condition_config')
  ) then
    raise exception 'Badge completion columns already exist or require reconciliation';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_category='author'
       and badge_id !~ '^author_badge_[0-9]{3}$'
  ) then
    raise exception 'Unexpected pre-completion Author badge IDs require reconciliation';
  end if;
end
$$;
