begin;

do $$
declare
  v_reader uuid := gen_random_uuid();
  v_novel text := 'seed-discovery-' || gen_random_uuid()::text;
  v_sent timestamptz := now() - interval '10 days';
  v_seed uuid;
  v_seed_2 uuid;
  v_event uuid;
  v_total integer;
  v_expected integer[] := array[150, 300, 600, 1000];
  v_step integer := 0;
begin
  -- BRONZE proves cumulative +2/+3/+4/+5 awards and delta-only progression.
  v_seed := gen_random_uuid();
  insert into public.seed_discovery_state values
    (v_seed, v_reader, v_novel, 'BRONZE', 1, 1, 0, 0, v_sent + interval '180 days', now());
  foreach v_total in array array[3,4,5,6] loop
    v_step := v_step + 1;
    insert into public.novel_rank_events
      (novel_id_snapshot, author_id_snapshot, from_rank, to_rank, event_type, occurred_at)
    values (v_novel, gen_random_uuid(), v_total - 1, v_total, 'promotion', v_sent + interval '1 day')
    returning id into v_event;
    if (select cumulative_discovery_xp from public.seed_discovery_state where seed_id = v_seed) <> v_expected[v_step] then
      raise exception 'BRONZE tier % cumulative EXP mismatch', v_step;
    end if;
  end loop;
  select coalesce(sum(x.xp_value), 0) into v_total
    from public.scout_xp_ledger x join public.scout_event_ledger e on e.id = x.source_event_id
   where e.seed_id = v_seed and x.xp_kind = 'light_seed_discovery';
  if v_total <> 1000 then raise exception 'BRONZE cumulative discovery expected 1000, got %', v_total; end if;

  -- Replaying, demoting, and returning to the peak cannot duplicate an award.
  perform public.novelight_process_seed_discovery(v_event);
  insert into public.novel_rank_events
    (novel_id_snapshot, author_id_snapshot, from_rank, to_rank, event_type, occurred_at)
  values (v_novel, gen_random_uuid(), 6, 5, 'demotion', v_sent + interval '2 days'),
         (v_novel, gen_random_uuid(), 5, 6, 'promotion', v_sent + interval '3 days');
  select coalesce(sum(x.xp_value), 0) into v_total
    from public.scout_xp_ledger x join public.scout_event_ledger e on e.id = x.source_event_id
   where e.seed_id = v_seed and x.xp_kind = 'light_seed_discovery';
  if v_total <> 1000 then raise exception 'replay/demotion duplicated discovery EXP'; end if;

  -- Exact multipliers and independent attribution.
  foreach v_total in array array[1,2] loop
    v_seed_2 := gen_random_uuid();
    insert into public.seed_discovery_state values
      (v_seed_2, v_reader, v_novel || v_total, case v_total when 1 then 'SILVER' else 'GOLD' end,
       1, 1, 0, 0, v_sent + interval '180 days', now());
    insert into public.novel_rank_events
      (novel_id_snapshot, author_id_snapshot, from_rank, to_rank, event_type, occurred_at)
    values (v_novel || v_total, gen_random_uuid(), 1, 3, 'promotion', v_sent + interval '1 day');
    if (select cumulative_discovery_xp from public.seed_discovery_state where seed_id = v_seed_2)
       <> case v_total when 1 then 225 else 300 end then
      raise exception 'SEED multiplier mismatch';
    end if;
  end loop;
  if (select sum(x.xp_value) from public.scout_xp_ledger x join public.scout_event_ledger e on e.id=x.source_event_id where e.seed_id=v_seed_2) <> 300 then
    raise exception 'GOLD multiplier is not exact';
  end if;

  -- NOVA prediction and the closed 180-day boundary.
  v_seed_2 := gen_random_uuid();
  insert into public.seed_discovery_state values
    (v_seed_2, v_reader, v_novel || 'nova', 'SILVER', 5, 5, 0, 0, v_sent + interval '180 days', now());
  insert into public.novel_rank_events
    (novel_id_snapshot, author_id_snapshot, from_rank, to_rank, event_type, occurred_at)
  values (v_novel || 'nova', gen_random_uuid(), 5, 6, 'promotion', v_sent + interval '1 day');
  if (select sum(x.xp_value) from public.scout_xp_ledger x join public.scout_event_ledger e on e.id=x.source_event_id where e.seed_id=v_seed_2) <> 120 then
    raise exception 'SILVER NOVA prediction expected 120';
  end if;
  v_seed_2 := gen_random_uuid();
  insert into public.seed_discovery_state values
    (v_seed_2, v_reader, v_novel || 'expired', 'GOLD', 1, 1, 0, 0, v_sent + interval '180 days', now());
  insert into public.novel_rank_events
    (novel_id_snapshot, author_id_snapshot, from_rank, to_rank, event_type, occurred_at)
  values (v_novel || 'expired', gen_random_uuid(), 1, 6, 'promotion', v_sent + interval '181 days');
  if exists (select 1 from public.scout_event_ledger where seed_id=v_seed_2 and event_type='light_seed_discovery') then
    raise exception 'post-window Rank awarded discovery EXP';
  end if;
end
$$;

set local role authenticated;
do $$ begin
  perform public.novelight_process_seed_discovery(gen_random_uuid());
  raise exception 'authenticated caller forged discovery processing';
exception when insufficient_privilege then null;
end $$;
rollback;
