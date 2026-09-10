do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.post_novel_comment(text,text)'::regprocedure)
    into v_definition;

  if position('v_is_self_comment' in v_definition) = 0
     or position('novel_author_id' in v_definition) = 0
     or position('xp_eligible' in v_definition) = 0 then
    raise exception 'Self-comment EXP guard is missing from post_novel_comment';
  end if;

  if has_function_privilege('anon', 'public.post_novel_comment(text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.post_novel_comment(text,text)', 'EXECUTE') then
    raise exception 'Comment post privileges changed unexpectedly';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
      left join public.novels n on n.id::text = e.novel_id_snapshot
     where x.xp_kind = 'comment'
       and x.rule_version = 'beta-v1'
       and (
         (e.metadata ? 'xp_eligible' and e.metadata ->> 'xp_eligible' <> 'true')
         or (
           not (e.metadata ? 'xp_eligible')
           and n.id is not null
           and e.user_id = n.user_id
         )
       )
  ) then
    raise exception 'Self-comment SCOUT EXP is present after migration';
  end if;

  if exists (
    with eligible_events as (
      select
        e.id as source_event_id,
        e.user_id,
        e.novel_id_snapshot,
        e.occurred_at,
        case
          when e.metadata ? 'xp_eligible' then e.metadata ->> 'xp_eligible' = 'true'
          when n.id is not null then e.user_id is distinct from n.user_id
          else true
        end as xp_eligible
      from public.scout_event_ledger e
      left join public.novels n on n.id::text = e.novel_id_snapshot
      where e.event_type = 'comment_posted'
        and e.user_id is not null
        and e.novel_id_snapshot is not null
    ),
    first_work_day as (
      select
        e.source_event_id,
        e.user_id,
        e.novel_id_snapshot,
        e.occurred_at,
        row_number() over (
          partition by
            e.user_id,
            e.novel_id_snapshot,
            pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
          order by e.occurred_at, e.source_event_id
        ) as work_day_order
      from eligible_events e
      where e.xp_eligible
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
        from first_work_day f
        where f.work_day_order = 1
      ) d
      where daily_order <= 3
    ),
    actual as (
      select x.source_event_id
      from public.scout_xp_ledger x
      where x.xp_kind = 'comment'
        and x.rule_version = 'beta-v1'
    ),
    diff as (
      (select source_event_id from expected except select source_event_id from actual)
      union all
      (select source_event_id from actual except select source_event_id from expected)
    )
    select 1 from diff
  ) then
    raise exception 'Comment XP ledger does not match self-comment-safe replay rules';
  end if;
end
$$;
