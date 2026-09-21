\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_badge_runtime_config') is null
     or to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.valid_read_events') is null
     or to_regclass('public.novel_star_ratings') is null
     or to_regclass('public.novel_comments') is null
     or to_regclass('public.light_seeds') is null
     or to_regclass('public.seed_discovery_state') is null
     or to_regclass('public.novel_rank_events') is null then
    raise exception 'Badge System catalog prerequisites are missing';
  end if;

  if not exists (
    select 1
      from public.scout_badge_runtime_config
     where id = 1
       and retroactive_policy = 'none'
  ) then
    raise exception 'Badge retroactive policy must remain none before catalog activation';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_category = 'reader'
       and enabled
  ) then
    raise exception 'Enabled Reader Badge catalog already exists';
  end if;

  if (
    select count(*)
      from public.scout_badge_definitions
     where badge_category = 'author'
       and enabled
  ) <> 40 then
    raise exception 'Expected deployed Author Badge foundation with exactly 40 enabled definitions';
  end if;

  if (
    select count(*)
      from public.scout_badge_definitions
     where badge_category = 'limited'
       and enabled
  ) <> 2 then
    raise exception 'Expected Founding Author and beta Participant Limited badges';
  end if;

  if has_table_privilege('authenticated', 'public.scout_badge_definitions', 'select')
     or has_table_privilege('authenticated', 'public.user_scout_badges', 'select') then
    raise exception 'Raw badge tables must remain RPC-only before catalog activation';
  end if;
end
$$;
