-- NOVELIGHT SCOUT / LIGHT SEED beta event foundations postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_table text;
  v_relrowsecurity boolean;
begin
  foreach v_table in array array[
    'scout_event_ledger',
    'scout_xp_ledger',
    'novel_rank_state',
    'novel_rank_events',
    'valid_read_rules',
    'valid_read_sessions',
    'valid_read_events',
    'light_seed_monthly_inventory',
    'seed_discovery_state'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Missing SCOUT beta foundation table: %', v_table;
    end if;

    select c.relrowsecurity into v_relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = v_table;

    if not coalesce(v_relrowsecurity, false) then
      raise exception 'RLS must be enabled on public.%', v_table;
    end if;
  end loop;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'light_seeds'
      and column_name in ('seed_type', 'rank_at_seed', 'rank_code_at_seed', 'valid_read_event_id')
  ) <> 4 then
    raise exception 'LIGHT SEED v2 snapshot columns are incomplete';
  end if;

  if to_regprocedure('public.light_seed_status_v2(text)') is null
     or to_regprocedure('public.plant_light_seed_v2(text,text)') is null
     or to_regprocedure('public.record_valid_read_progress(text,uuid,double precision,integer,integer)') is null
     or to_regprocedure('public.novelight_ensure_light_seed_inventory(uuid,date)') is null
     or to_regprocedure('public.novelight_rank_code(smallint)') is null then
    raise exception 'One or more SCOUT beta foundation functions are missing';
  end if;

  -- The first foundation PR is deliberately additive. The current public UI
  -- still uses v1 until the dedicated cutover PR switches atomically to v2.
  if to_regprocedure('public.light_seed_status(text)') is null
     or to_regprocedure('public.plant_light_seed(text)') is null then
    raise exception 'Staged rollout unexpectedly removed the current LIGHT SEED v1 RPCs';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges p
    where p.table_schema = 'public'
      and p.table_name in (
        'scout_event_ledger', 'scout_xp_ledger', 'novel_rank_state',
        'novel_rank_events', 'valid_read_rules', 'valid_read_sessions',
        'valid_read_events', 'light_seed_monthly_inventory', 'seed_discovery_state'
      )
      and p.grantee in ('anon', 'authenticated')
  ) then
    raise exception 'Hidden SCOUT beta tables must not grant direct client table privileges';
  end if;

  if exists (
    select 1
    from public.novels n
    where n.status = 'published'
      and not exists (
        select 1 from public.novel_rank_state r
        where r.novel_id_snapshot = n.id::text
      )
  ) then
    raise exception 'Every published work must have a Rank state after foundation backfill';
  end if;
end
$$;

select 'PASS: SCOUT beta event foundations postcheck' as result;