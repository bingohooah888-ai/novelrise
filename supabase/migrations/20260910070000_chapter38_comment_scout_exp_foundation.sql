-- NOVELIGHT Chapter 38 work-comment foundation and SCOUT EXP.
--
-- MASTER contract implemented here:
-- - a valid comment is worth 5 XP
-- - only the first comment on the same work per user/JST day can award XP
-- - at most 3 different works per user/JST day can award comment XP
-- - comments remain usable after the daily XP cap is reached
-- - comment length does not change the XP value
--
-- Comment UI is intentionally out of scope for this migration. Raw comment
-- history is written to scout_event_ledger and derived XP remains replayable.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910070000'));

do $$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Chapter 38 SCOUT and novel foundations are required';
  end if;

  if to_regclass('public.novel_comments') is not null then
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'id'
         and data_type = 'uuid'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'novel_id'
         and data_type = 'bigint'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'user_id'
         and data_type = 'uuid'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'body'
         and data_type = 'text'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'created_at'
         and data_type = 'timestamp with time zone'
    ) or not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'deleted_at'
         and data_type = 'timestamp with time zone'
    ) then
      raise exception 'Existing novel_comments schema requires manual reconciliation';
    end if;
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is not null
     or to_regprocedure('public.delete_novel_comment(uuid)') is not null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is not null then
    raise exception 'Comment runtime is already installed';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
  ) then
    raise exception 'Existing comment SCOUT EXP requires manual reconciliation';
  end if;
end
$$;

create table if not exists public.novel_comments (
  id uuid primary key default gen_random_uuid(),
  novel_id bigint not null references public.novels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint novel_comments_body_nonempty check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists novel_comments_novel_recent_idx
  on public.novel_comments (novel_id, created_at desc, id desc)
  where deleted_at is null;
create index if not exists novel_comments_user_recent_idx
  on public.novel_comments (user_id, created_at desc);

alter table public.novel_comments enable row level security;
revoke all on table public.novel_comments from public, anon, authenticated;

-- Replay prior raw comment history after a rollback. Only the first event for a
-- user/work/JST day is eligible, then only the first three eligible works that
-- day receive the fixed 5 XP award.
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
daily_ranked as (
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
)
insert into public.scout_xp_ledger (
  user_id,
  source_event_id,
  xp_kind,
  xp_value,
  rule_version,
  occurred_at
)
select
  d.user_id,
  d.source_event_id,
  'comment',
  5,
  'beta-v1',
  d.occurred_at
from daily_ranked d
where d.daily_order <= 3
on conflict (user_id, source_event_id, xp_kind) do nothing;

create or replace function public.novelight_comment_feed(
  p_novel_id text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novel_id bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    return '[]'::jsonb;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'user_id', q.user_id,
        'display_name', q.display_name,
        'body', q.body,
        'created_at', q.created_at,
        'can_delete', q.user_id = v_uid
      ) order by q.created_at desc, q.id desc
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select c.id, c.user_id, p.display_name, c.body, c.created_at
        from public.novel_comments c
        join public.profiles p on p.id = c.user_id
       where c.novel_id = v_novel_id
         and c.deleted_at is null
       order by c.created_at desc, c.id desc
       limit v_limit
    ) q;

  return v_result;
end
$$;

create or replace function public.post_novel_comment(
  p_novel_id text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id bigint;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_comment_id uuid := pg_catalog.gen_random_uuid();
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_event_at timestamptz := pg_catalog.now();
  v_had_work_today boolean := false;
  v_awarded_today integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if pg_catalog.char_length(v_body) < 1 or pg_catalog.char_length(v_body) > 2000 then
    raise exception using errcode = '22023', message = 'コメントは1文字以上2000文字以内で入力してください';
  end if;

  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  -- Serialize one reader's comment actions so same-work/day eligibility and the
  -- three-work daily cap cannot race across simultaneous requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:comment-xp:' || v_uid::text, 0)
  );

  select exists (
    select 1
      from public.scout_event_ledger e
     where e.user_id = v_uid
       and e.novel_id_snapshot = p_novel_id
       and e.event_type = 'comment_posted'
       and pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
           = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date
  ) into v_had_work_today;

  insert into public.novel_comments (
    id,
    novel_id,
    user_id,
    body,
    created_at
  ) values (
    v_comment_id,
    v_novel_id,
    v_uid,
    v_body,
    v_event_at
  );

  insert into public.scout_event_ledger (
    id,
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    occurred_at,
    metadata
  ) values (
    v_event_id,
    v_uid,
    'comment_posted',
    'comment_posted:' || v_comment_id::text,
    p_novel_id,
    v_event_at,
    pg_catalog.jsonb_build_object('comment_id', v_comment_id)
  );

  if not v_had_work_today then
    select count(*)::integer
      into v_awarded_today
      from public.scout_xp_ledger x
     where x.user_id = v_uid
       and x.xp_kind = 'comment'
       and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
           = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date;

    if v_awarded_today < 3 then
      insert into public.scout_xp_ledger (
        user_id,
        source_event_id,
        xp_kind,
        xp_value,
        rule_version,
        occurred_at
      ) values (
        v_uid,
        v_event_id,
        'comment',
        5,
        'beta-v1',
        v_event_at
      )
      on conflict (user_id, source_event_id, xp_kind) do nothing;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_comment_id,
    'created_at', v_event_at
  );
end
$$;

create or replace function public.delete_novel_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id text;
  v_deleted_at timestamptz;
  v_event_at timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select c.novel_id::text, c.deleted_at
    into v_novel_id, v_deleted_at
    from public.novel_comments c
   where c.id = p_comment_id
     and c.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = '削除できるコメントが見つかりません';
  end if;

  if v_deleted_at is not null then
    return pg_catalog.jsonb_build_object('deleted', true);
  end if;

  update public.novel_comments
     set deleted_at = v_event_at
   where id = p_comment_id;

  insert into public.scout_event_ledger (
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    occurred_at,
    metadata
  ) values (
    v_uid,
    'comment_deleted',
    'comment_deleted:' || p_comment_id::text,
    v_novel_id,
    v_event_at,
    pg_catalog.jsonb_build_object('comment_id', p_comment_id)
  )
  on conflict (event_key) do nothing;

  return pg_catalog.jsonb_build_object('deleted', true);
end
$$;

revoke all on function public.novelight_comment_feed(text, integer) from public;
grant execute on function public.novelight_comment_feed(text, integer) to anon, authenticated;

revoke all on function public.post_novel_comment(text, text) from public, anon;
grant execute on function public.post_novel_comment(text, text) to authenticated;

revoke all on function public.delete_novel_comment(uuid) from public, anon;
grant execute on function public.delete_novel_comment(uuid) to authenticated;

commit;
