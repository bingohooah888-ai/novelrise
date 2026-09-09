do $$
begin
  if to_regclass('public.novel_comments') is null then
    raise exception 'novel_comments is missing after migration';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_comments'
       and c.relrowsecurity
  ) then
    raise exception 'novel_comments RLS must be enabled';
  end if;

  if has_table_privilege('anon', 'public.novel_comments', 'SELECT')
     or has_table_privilege('anon', 'public.novel_comments', 'INSERT')
     or has_table_privilege('anon', 'public.novel_comments', 'UPDATE')
     or has_table_privilege('anon', 'public.novel_comments', 'DELETE')
     or has_table_privilege('authenticated', 'public.novel_comments', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_comments', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_comments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_comments', 'DELETE') then
    raise exception 'Clients must not access novel_comments directly';
  end if;

  if to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.delete_novel_comment(uuid)') is null then
    raise exception 'Comment RPC contract is incomplete';
  end if;

  if not has_function_privilege('anon', 'public.novelight_comment_feed(text,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_comment_feed(text,integer)', 'EXECUTE') then
    raise exception 'Comment feed read access is incomplete';
  end if;

  if has_function_privilege('anon', 'public.post_novel_comment(text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.post_novel_comment(text,text)', 'EXECUTE') then
    raise exception 'Comment post access changed unexpectedly';
  end if;

  if has_function_privilege('anon', 'public.delete_novel_comment(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_novel_comment(uuid)', 'EXECUTE') then
    raise exception 'Comment delete access changed unexpectedly';
  end if;

  if position(
    'novelight:comment-xp:' in
    pg_get_functiondef('public.post_novel_comment(text,text)'::regprocedure)
  ) = 0 then
    raise exception 'Comment XP serialization lock is missing';
  end if;

  if exists (
    select 1
      from public.novel_comments c
     where char_length(btrim(c.body)) < 1
        or char_length(btrim(c.body)) > 2000
  ) then
    raise exception 'Stored comment length contract is invalid';
  end if;

  if exists (
    select 1
      from public.novel_comments c
     where not exists (
       select 1
         from public.scout_event_ledger e
        where e.user_id = c.user_id
          and e.novel_id_snapshot = c.novel_id::text
          and e.event_type = 'comment_posted'
          and e.metadata ->> 'comment_id' = c.id::text
     )
  ) then
    raise exception 'A stored comment is missing raw comment_posted evidence';
  end if;

  if exists (
    select 1
      from public.novel_comments c
     where c.deleted_at is not null
       and not exists (
         select 1
           from public.scout_event_ledger e
          where e.user_id = c.user_id
            and e.novel_id_snapshot = c.novel_id::text
            and e.event_type = 'comment_deleted'
            and e.metadata ->> 'comment_id' = c.id::text
       )
  ) then
    raise exception 'A deleted comment is missing raw deletion evidence';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
       and (x.xp_value <> 5 or x.rule_version <> 'beta-v1')
  ) then
    raise exception 'Comment XP values or rule version are invalid';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.xp_kind = 'comment'
       and e.event_type <> 'comment_posted'
  ) then
    raise exception 'Comment XP must come only from comment_posted events';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.xp_kind = 'comment'
     group by
       x.user_id,
       e.novel_id_snapshot,
       pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
    having count(*) > 1
  ) then
    raise exception 'A user/work/JST-day received comment XP more than once';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
     group by
       x.user_id,
       pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
    having count(*) > 3
  ) then
    raise exception 'Comment XP daily work cap exceeded';
  end if;

  if exists (
    with first_work_day as (
      select
        e.id as source_event_id,
        e.user_id,
        e.novel_id_snapshot,
        e.occurred_at,
        row_number() over (
          partition by
            e.user_id,
            e.novel_id_snapshot,
            pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
          order by e.occurred_at, e.id
        ) as work_day_order
      from public.scout_event_ledger e
      where e.event_type = 'comment_posted'
        and e.user_id is not null
        and e.novel_id_snapshot is not null
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
    ),
    diff as (
      (select source_event_id from expected except select source_event_id from actual)
      union all
      (select source_event_id from actual except select source_event_id from expected)
    )
    select 1 from diff
  ) then
    raise exception 'Comment XP ledger does not match replayable beta rules';
  end if;
end
$$;
