\set ON_ERROR_STOP on

-- Hidden SCOUT ledgers must not become beta-facing tables.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

do $$
begin
  begin
    perform count(*) from public.scout_event_ledger;
    raise exception 'authenticated reader unexpectedly read hidden SCOUT event ledger';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- Own-work reading can never become a valid read.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  begin
    perform public.record_valid_read_progress(
      '11000000-0000-0000-0000-000000000001',
      'a1000000-0000-0000-0000-000000000001',
      0.5,
      3,
      1
    );
    raise exception 'author unexpectedly qualified own-work reading';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

-- Reader 3 cannot send a v2 seed before a valid read exists.
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

do $$
begin
  begin
    perform public.plant_light_seed_v2(
      '10000000-0000-0000-0000-000000000001',
      'GOLD'
    );
    raise exception 'reader unexpectedly seeded without a valid read';
  exception
    when check_violation then null;
  end;
end
$$;

-- 2-of-3 qualification: progress + meaningful interaction is enough even when
-- foreground time has not yet reached its independent threshold.
select public.test_assert(
  (public.record_valid_read_progress(
    '11000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    0.5,
    3,
    1
  )->>'qualified')::boolean,
  'progress + interaction should establish a valid read'
);

-- A new retry/session for an already qualified reader/episode must not create a
-- second activity event.
select public.test_assert(
  (public.record_valid_read_progress(
    '11000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000002',
    1.0,
    99,
    1
  )->>'newly_qualified')::boolean = false,
  'mechanical reread must not create a new valid-read qualification'
);

reset role;

select public.test_assert(
  (select count(*) = 1
   from public.valid_read_events
   where reader_id = '33333333-3333-3333-3333-333333333333'
     and episode_id_snapshot = '11000000-0000-0000-0000-000000000001'),
  'reader/episode valid-read event must be lifetime-deduped'
);

select public.test_assert(
  (select count(*) = 1
   from public.scout_event_ledger
   where event_key = 'valid_read:33333333-3333-3333-3333-333333333333:11000000-0000-0000-0000-000000000001'),
  'valid-read SCOUT event must be idempotent'
);

-- First typed seed snapshots Rank 1 EMBER and awards hidden seed-use XP once.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.plant_light_seed_v2(
  '10000000-0000-0000-0000-000000000001',
  'GOLD'
);
reset role;

select public.test_assert(
  exists (
    select 1 from public.light_seeds s
    where s.reader_id = '33333333-3333-3333-3333-333333333333'
      and s.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
      and s.seed_type = 'GOLD'
      and s.rank_at_seed = 1
      and s.rank_code_at_seed = 'EMBER'
      and s.valid_read_event_id is not null
  ),
  'typed LIGHT SEED must persist type, send-time Rank, and valid-read proof'
);

select public.test_assert(
  (select current_rank = 1
   from public.novel_rank_state
   where novel_id_snapshot = '10000000-0000-0000-0000-000000000001'),
  'LIGHT SEED must not directly increase work Rank'
);

select public.test_assert(
  (select count(*) = 1
   from public.scout_xp_ledger x
   join public.scout_event_ledger e on e.id = x.source_event_id
   where e.event_type = 'light_seed_sent'
     and e.user_id = '33333333-3333-3333-3333-333333333333'
     and e.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
     and x.xp_kind = 'light_seed_use'
     and x.xp_value = 30),
  'GOLD seed-use XP must be recorded once in the hidden replay ledger'
);

-- Retry the same work. The lifetime unique constraint must reject it and leave
-- event/XP state unchanged.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

do $$
begin
  begin
    perform public.plant_light_seed_v2(
      '10000000-0000-0000-0000-000000000001',
      'SILVER'
    );
    raise exception 'reader unexpectedly seeded the same work twice';
  exception
    when unique_violation then null;
  end;
end
$$;
reset role;

select public.test_assert(
  (select count(*) = 1
   from public.scout_xp_ledger x
   join public.scout_event_ledger e on e.id = x.source_event_id
   where e.user_id = '33333333-3333-3333-3333-333333333333'
     and e.novel_id_snapshot = '10000000-0000-0000-0000-000000000001'
     and x.xp_kind = 'light_seed_use'),
  'relogin/retry/duplicate send must not duplicate seed-use XP'
);

-- Consume Reader 3's remaining 10 seeds: 5 GOLD, 3 SILVER, 2 BRONZE.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

do $$
declare
  i integer;
  v_type text;
begin
  for i in 1..10 loop
    perform public.record_valid_read_progress(
      '71000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
      ('a3100000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      0.5,
      3,
      1
    );

    v_type := case
      when i <= 5 then 'GOLD'
      when i <= 8 then 'SILVER'
      else 'BRONZE'
    end;

    perform public.plant_light_seed_v2(
      '70000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
      v_type
    );
  end loop;
end
$$;
reset role;

select public.test_assert(
  exists (
    select 1
    from public.light_seed_monthly_inventory i
    where i.user_id = '33333333-3333-3333-3333-333333333333'
      and i.seed_month = date_trunc('month', timezone('Asia/Tokyo', now()))::date
      and i.gold_allocated = 6 and i.silver_allocated = 3 and i.bronze_allocated = 2
      and i.gold_used = 6 and i.silver_used = 3 and i.bronze_used = 2
      and i.legacy_used = 0
  ),
  'monthly inventory must be exactly GOLD 6 / SILVER 3 / BRONZE 2'
);

select public.test_assert(
  (select count(*) = 11
   from public.light_seeds s
   where s.reader_id = '33333333-3333-3333-3333-333333333333'
     and s.seed_month = date_trunc('month', timezone('Asia/Tokyo', now()))::date),
  'reader must have exactly eleven successful LIGHT SEED sends in the month'
);

-- Establish a valid read on another work, then prove total inventory blocks #12.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select public.record_valid_read_progress(
  '71000000-0000-0000-0000-000000000011',
  'a3100000-0000-0000-0000-000000000011',
  0.5,
  3,
  1
);

do $$
begin
  begin
    perform public.plant_light_seed_v2(
      '70000000-0000-0000-0000-000000000011',
      'BRONZE'
    );
    raise exception 'reader unexpectedly exceeded monthly total inventory';
  exception
    when check_violation then null;
  end;
end
$$;
reset role;

-- Reader 4 exhausts GOLD only. A seventh GOLD must fail while SILVER/BRONZE
-- inventory still exists.
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);

do $$
declare
  i integer;
begin
  for i in 12..17 loop
    perform public.record_valid_read_progress(
      '71000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
      ('a4100000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      0.5,
      3,
      1
    );
    perform public.plant_light_seed_v2(
      '70000000-0000-0000-0000-' || lpad(i::text, 12, '0'),
      'GOLD'
    );
  end loop;

  perform public.record_valid_read_progress(
    '71000000-0000-0000-0000-000000000018',
    'a4100000-0000-0000-0000-000000000018',
    0.5,
    3,
    1
  );

  begin
    perform public.plant_light_seed_v2(
      '70000000-0000-0000-0000-000000000018',
      'GOLD'
    );
    raise exception 'reader unexpectedly exceeded GOLD inventory';
  exception
    when check_violation then null;
  end;
end
$$;

-- High-PV works are no longer excluded by the v2 contract. After a valid read,
-- eligibility depends on the Chapter 38 rules rather than the old unknown-work
-- PV/favorite thresholds.
select public.record_valid_read_progress(
  '22000000-0000-0000-0000-000000000001',
  'a4200000-0000-0000-0000-000000000001',
  0.5,
  3,
  1
);
select public.test_assert(
  public.light_seed_status_v2('20000000-0000-0000-0000-000000000001')->>'reason' = 'eligible',
  'v2 LIGHT SEED must not use the legacy high-PV unknown-work gate'
);
reset role;

-- Lazy inventory creation is idempotent and gives a mid-month user the full
-- current-month 6/3/2 allocation. A previous month is independent and cannot
-- carry usage into the current month.
select public.novelight_ensure_light_seed_inventory(
  '55555555-5555-5555-5555-555555555555',
  (date_trunc('month', timezone('Asia/Tokyo', now())) - interval '1 month')::date
);
update public.light_seed_monthly_inventory
set gold_used = 6, silver_used = 3, bronze_used = 2
where user_id = '55555555-5555-5555-5555-555555555555'
  and seed_month = (date_trunc('month', timezone('Asia/Tokyo', now())) - interval '1 month')::date;

select public.novelight_ensure_light_seed_inventory(
  '55555555-5555-5555-5555-555555555555',
  date_trunc('month', timezone('Asia/Tokyo', now()))::date
);
select public.novelight_ensure_light_seed_inventory(
  '55555555-5555-5555-5555-555555555555',
  date_trunc('month', timezone('Asia/Tokyo', now()))::date
);

select public.test_assert(
  (select count(*) = 1
   from public.light_seed_monthly_inventory i
   where i.user_id = '55555555-5555-5555-5555-555555555555'
     and i.seed_month = date_trunc('month', timezone('Asia/Tokyo', now()))::date
     and i.gold_allocated = 6 and i.silver_allocated = 3 and i.bronze_allocated = 2
     and i.gold_used = 0 and i.silver_used = 0 and i.bronze_used = 0),
  'monthly grant must be idempotent, full for mid-month users, and non-carrying'
);

-- A long gap between heartbeats represents hidden/background/inactive time and
-- must earn zero foreground seconds.
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.record_valid_read_progress(
  '71000000-0000-0000-0000-000000000019',
  'a5100000-0000-0000-0000-000000000019',
  0.0,
  0,
  1
);
reset role;

update public.valid_read_sessions
set last_heartbeat_at = now() - interval '5 minutes'
where reader_id = '55555555-5555-5555-5555-555555555555'
  and session_id = 'a5100000-0000-0000-0000-000000000019';

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.record_valid_read_progress(
  '71000000-0000-0000-0000-000000000019',
  'a5100000-0000-0000-0000-000000000019',
  0.0,
  0,
  2
);
reset role;

select public.test_assert(
  (select foreground_seconds = 0
   from public.valid_read_sessions
   where reader_id = '55555555-5555-5555-5555-555555555555'
     and session_id = 'a5100000-0000-0000-0000-000000000019'),
  'background/inactive heartbeat gap must not count as active foreground time'
);
select public.test_assert(
  not exists (
    select 1 from public.valid_read_events
    where reader_id = '55555555-5555-5555-5555-555555555555'
      and episode_id_snapshot = '71000000-0000-0000-0000-000000000019'
  ),
  'background-only session must not become a valid read'
);

-- Basic BOT/mass-operation protection: cap new valid-read sessions per hour.
set role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);

do $$
declare
  i integer;
begin
  for i in 1..30 loop
    perform public.record_valid_read_progress(
      '71000000-0000-0000-0000-000000000020',
      ('a8800000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      0.0,
      0,
      1
    );
  end loop;

  begin
    perform public.record_valid_read_progress(
      '71000000-0000-0000-0000-000000000020',
      'a8800000-0000-0000-0000-000000000031',
      0.0,
      0,
      1
    );
    raise exception 'reader unexpectedly exceeded valid-read session rate limit';
  exception
    when sqlstate 'P0001' then null;
  end;
end
$$;
reset role;

-- Every typed seed gets exactly one discovery-state row. A single seed cannot
-- create duplicate state when a work later demotes and re-promotes.
select public.test_assert(
  not exists (
    select s.id
    from public.light_seeds s
    where s.seed_type is not null
    group by s.id
    having (select count(*) from public.seed_discovery_state d where d.seed_id = s.id) <> 1
  ),
  'typed seed must own exactly one discovery state record'
);

do $$
declare
  v_seed public.light_seeds%rowtype;
begin
  select * into v_seed
  from public.light_seeds s
  where s.reader_id = '33333333-3333-3333-3333-333333333333'
    and s.novel_id_snapshot = '10000000-0000-0000-0000-000000000001';

  begin
    insert into public.seed_discovery_state (
      seed_id,
      reader_id,
      novel_id_snapshot,
      seed_type,
      rank_at_seed,
      highest_rank_seen,
      best_rank_delta,
      cumulative_discovery_xp,
      window_expires_at
    ) values (
      v_seed.id,
      v_seed.reader_id,
      v_seed.novel_id_snapshot,
      v_seed.seed_type,
      v_seed.rank_at_seed,
      v_seed.rank_at_seed,
      0,
      0,
      v_seed.seeded_at + interval '180 days'
    );
    raise exception 'duplicate discovery state unexpectedly inserted';
  exception
    when unique_violation then null;
  end;
end
$$;

select public.test_assert(
  not exists (
    select 1 from public.novel_rank_state
    where current_rank <> 1 or peak_rank <> 1
  ),
  'LIGHT SEED and valid reading must not directly alter work Rank'
);

select 'PASS: SCOUT beta event foundations behavior' as result;