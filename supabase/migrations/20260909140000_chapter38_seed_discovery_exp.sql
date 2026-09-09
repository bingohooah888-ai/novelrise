-- Chapter 38: replayable 180-day LIGHT SEED discovery EXP.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909140000'));

create or replace function public.novelight_process_seed_discovery(p_rank_event_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rank_event public.novel_rank_events%rowtype;
  v_seed public.seed_discovery_state%rowtype;
  v_base_xp integer;
  v_multiplier numeric;
  v_cumulative_xp integer;
  v_delta_xp integer;
  v_event_id uuid;
begin
  select * into v_rank_event
    from public.novel_rank_events
   where id = p_rank_event_id;

  if not found then
    return;
  end if;

  for v_seed in
    select s.*
      from public.seed_discovery_state s
     where s.novel_id_snapshot = v_rank_event.novel_id_snapshot
       and v_rank_event.occurred_at >= s.window_expires_at - interval '180 days'
       and v_rank_event.occurred_at <= s.window_expires_at
       and v_rank_event.to_rank > s.highest_rank_seen
     order by s.seed_id
     for update
  loop
    v_base_xp := case
      when v_seed.rank_at_seed = 5 and v_rank_event.to_rank = 6 then 80
      when v_rank_event.to_rank - v_seed.rank_at_seed >= 5 then 1000
      when v_rank_event.to_rank - v_seed.rank_at_seed = 4 then 600
      when v_rank_event.to_rank - v_seed.rank_at_seed = 3 then 300
      when v_rank_event.to_rank - v_seed.rank_at_seed = 2 then 150
      else 0
    end;
    v_multiplier := case v_seed.seed_type
      when 'GOLD' then 2.0
      when 'SILVER' then 1.5
      else 1.0
    end;
    v_cumulative_xp := (v_base_xp * v_multiplier)::integer;
    v_delta_xp := greatest(v_cumulative_xp - v_seed.cumulative_discovery_xp, 0);

    update public.seed_discovery_state
       set highest_rank_seen = greatest(highest_rank_seen, v_rank_event.to_rank),
           best_rank_delta = greatest(best_rank_delta, v_rank_event.to_rank - rank_at_seed),
           cumulative_discovery_xp = greatest(cumulative_discovery_xp, v_cumulative_xp),
           updated_at = now()
     where seed_id = v_seed.seed_id;

    if v_delta_xp > 0 then
      insert into public.scout_event_ledger (
        user_id, event_type, event_key, novel_id_snapshot, seed_id, occurred_at, metadata
      ) values (
        v_seed.reader_id,
        'light_seed_discovery',
        'light_seed_discovery:' || v_seed.seed_id::text || ':' || v_cumulative_xp::text,
        v_seed.novel_id_snapshot,
        v_seed.seed_id,
        v_rank_event.occurred_at,
        jsonb_build_object(
          'rank_event_id', v_rank_event.id,
          'seeded_at', v_seed.window_expires_at - interval '180 days',
          'window_expires_at', v_seed.window_expires_at,
          'seed_type', v_seed.seed_type,
          'rank_at_seed', v_seed.rank_at_seed,
          'reached_rank', v_rank_event.to_rank,
          'base_xp', v_base_xp,
          'multiplier', v_multiplier,
          'cumulative_xp', v_cumulative_xp,
          'delta_xp', v_delta_xp,
          'rule_version', 'chapter38-discovery-v1'
        )
      )
      on conflict (event_key) do nothing
      returning id into v_event_id;

      if v_event_id is not null then
        insert into public.scout_xp_ledger (
          user_id, source_event_id, xp_kind, xp_value, rule_version, occurred_at
        ) values (
          v_seed.reader_id, v_event_id, 'light_seed_discovery', v_delta_xp,
          'chapter38-discovery-v1', v_rank_event.occurred_at
        )
        on conflict (user_id, source_event_id, xp_kind) do nothing;
      end if;
    end if;
  end loop;
end
$$;

revoke all on function public.novelight_process_seed_discovery(uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_process_seed_discovery(uuid) to service_role;

create or replace function public.novelight_process_seed_discovery_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.novelight_process_seed_discovery(new.id);
  return new;
end
$$;

revoke all on function public.novelight_process_seed_discovery_trigger()
  from public, anon, authenticated;

create trigger novel_rank_events_process_seed_discovery
after insert on public.novel_rank_events
for each row execute function public.novelight_process_seed_discovery_trigger();

do $$
declare v_event record;
begin
  for v_event in
    select id from public.novel_rank_events order by occurred_at, id
  loop
    perform public.novelight_process_seed_discovery(v_event.id);
  end loop;
end
$$;

commit;
