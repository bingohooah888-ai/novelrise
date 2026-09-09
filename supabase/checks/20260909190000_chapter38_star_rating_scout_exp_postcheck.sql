do $$
begin
  if to_regprocedure('public.set_novel_star_rating(text,integer)') is null then
    raise exception 'Star-rating RPC is missing after migration';
  end if;

  if position(
    'novelight:star-rating-xp:' in
    pg_get_functiondef('public.set_novel_star_rating(text,integer)'::regprocedure)
  ) = 0 then
    raise exception 'Star-rating SCOUT EXP runtime is not installed';
  end if;

  if has_function_privilege('anon', 'public.set_novel_star_rating(text,integer)', 'EXECUTE') then
    raise exception 'anon must not execute star-rating writes';
  end if;

  if not has_function_privilege('authenticated', 'public.set_novel_star_rating(text,integer)', 'EXECUTE') then
    raise exception 'authenticated must retain star-rating write access';
  end if;

  if has_function_privilege('anon', 'public.clear_novel_star_rating(text)', 'EXECUTE') then
    raise exception 'anon must not execute star-rating clears';
  end if;

  if not has_function_privilege('authenticated', 'public.clear_novel_star_rating(text)', 'EXECUTE') then
    raise exception 'authenticated must retain star-rating clear access';
  end if;

  if not has_function_privilege('anon', 'public.novelight_star_rating_status(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_star_rating_status(text)', 'EXECUTE') then
    raise exception 'Star-rating status read access changed unexpectedly';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'star_rating'
       and (x.xp_value <> 3 or x.rule_version <> 'beta-v1')
  ) then
    raise exception 'Star-rating XP values or rule version are invalid';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.xp_kind = 'star_rating'
       and e.event_type <> 'star_rating_set'
  ) then
    raise exception 'Star-rating XP must come only from star_rating_set events';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.xp_kind = 'star_rating'
     group by x.user_id, e.novel_id_snapshot
    having count(*) > 1
  ) then
    raise exception 'A user/work pair received star-rating XP more than once';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'star_rating'
     group by
       x.user_id,
       pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
    having count(*) > 5
  ) then
    raise exception 'Star-rating XP daily cap exceeded';
  end if;

  if exists (
    with ranked_lifetime as (
      select
        e.id as source_event_id,
        e.user_id,
        e.novel_id_snapshot,
        e.occurred_at,
        row_number() over (
          partition by e.user_id, e.novel_id_snapshot
          order by e.occurred_at, e.id
        ) as lifetime_order
      from public.scout_event_ledger e
      where e.event_type = 'star_rating_set'
        and e.user_id is not null
        and e.novel_id_snapshot is not null
    ),
    first_lifetime as (
      select source_event_id, user_id, occurred_at
      from ranked_lifetime
      where lifetime_order = 1
    ),
    expected as (
      select source_event_id
      from (
        select
          f.*,
          row_number() over (
            partition by
              f.user_id,
              pg_catalog.timezone('Asia/Tokyo', f.occurred_at)::date
            order by f.occurred_at, f.source_event_id
          ) as daily_order
        from first_lifetime f
      ) d
      where daily_order <= 5
    ),
    actual as (
      select x.source_event_id
      from public.scout_xp_ledger x
      where x.xp_kind = 'star_rating'
    ),
    diff as (
      (select source_event_id from expected except select source_event_id from actual)
      union all
      (select source_event_id from actual except select source_event_id from expected)
    )
    select 1 from diff
  ) then
    raise exception 'Star-rating XP ledger does not match replayable beta rules';
  end if;
end
$$;
