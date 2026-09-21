\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'SCOUT RECORD beta core is missing';
  end if;

  if to_regclass('public.founding_authors') is null
     or to_regclass('public.beta_participants') is null then
    raise exception 'Founding / beta qualification ledgers are missing';
  end if;

  if to_regclass('public.scout_badge_definitions') is not null
     or to_regclass('public.user_scout_badges') is not null
     or to_regclass('public.scout_badge_metric_events') is not null then
    raise exception 'SCOUT badge foundation already exists or requires reconciliation';
  end if;
end
$$;
