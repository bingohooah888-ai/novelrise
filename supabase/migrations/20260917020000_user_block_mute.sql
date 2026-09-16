-- NOVELIGHT user safety: block direct interaction and mute personal display.
-- Block/Mute never rewrites SCOUT EXP, Rank, LIGHT SEED, or historical evidence.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917020000'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_comments') is null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null then
    raise exception 'NOVELIGHT profile, novel, and comment foundations are required';
  end if;
end
$$;

create table public.user_blocks (
  blocker_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint user_blocks_no_self check (blocker_user_id <> blocked_user_id)
);

create table public.user_mutes (
  muter_user_id uuid not null references public.profiles(id) on delete cascade,
  muted_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_user_id, muted_user_id),
  constraint user_mutes_no_self check (muter_user_id <> muted_user_id)
);

alter table public.user_blocks enable row level security;
alter table public.user_mutes enable row level security;

revoke all on table public.user_blocks from public, anon, authenticated;
revoke all on table public.user_mutes from public, anon, authenticated;

create or replace function public.novelight_user_relationship(p_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_exists boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_target_user_id is null or p_target_user_id = v_uid then
    raise exception using errcode = '22023', message = 'Invalid target user';
  end if;

  select exists(select 1 from public.profiles p where p.id = p_target_user_id)
    into v_exists;
  if not v_exists then
    raise exception using errcode = '23503', message = 'Target user not found';
  end if;

  return pg_catalog.jsonb_build_object(
    'blocked', exists(
      select 1 from public.user_blocks b
       where b.blocker_user_id = v_uid and b.blocked_user_id = p_target_user_id
    ),
    'muted', exists(
      select 1 from public.user_mutes m
       where m.muter_user_id = v_uid and m.muted_user_id = p_target_user_id
    )
  );
end
$$;

create or replace function public.novelight_set_user_block(
  p_target_user_id uuid,
  p_blocked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_target_user_id is null or p_target_user_id = v_uid then
    raise exception using errcode = '22023', message = 'Invalid target user';
  end if;
  if not exists(select 1 from public.profiles p where p.id = p_target_user_id) then
    raise exception using errcode = '23503', message = 'Target user not found';
  end if;

  if coalesce(p_blocked, false) then
    insert into public.user_blocks(blocker_user_id, blocked_user_id)
    values (v_uid, p_target_user_id)
    on conflict (blocker_user_id, blocked_user_id) do nothing;
  else
    delete from public.user_blocks
     where blocker_user_id = v_uid and blocked_user_id = p_target_user_id;
  end if;

  return public.novelight_user_relationship(p_target_user_id);
end
$$;

create or replace function public.novelight_set_user_mute(
  p_target_user_id uuid,
  p_muted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_target_user_id is null or p_target_user_id = v_uid then
    raise exception using errcode = '22023', message = 'Invalid target user';
  end if;
  if not exists(select 1 from public.profiles p where p.id = p_target_user_id) then
    raise exception using errcode = '23503', message = 'Target user not found';
  end if;

  if coalesce(p_muted, false) then
    insert into public.user_mutes(muter_user_id, muted_user_id)
    values (v_uid, p_target_user_id)
    on conflict (muter_user_id, muted_user_id) do nothing;
  else
    delete from public.user_mutes
     where muter_user_id = v_uid and muted_user_id = p_target_user_id;
  end if;

  return public.novelight_user_relationship(p_target_user_id);
end
$$;

create or replace function public.novelight_hidden_novel_ids(p_novel_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null or coalesce(pg_catalog.array_length(p_novel_ids, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;
  if pg_catalog.array_length(p_novel_ids, 1) > 100 then
    raise exception using errcode = '22023', message = 'Too many novel ids';
  end if;

  select coalesce(pg_catalog.jsonb_agg(n.id::text order by n.id), '[]'::jsonb)
    into v_result
    from public.novels n
   where n.id::text = any(p_novel_ids)
     and (
       exists(
         select 1 from public.user_mutes m
          where m.muter_user_id = v_uid and m.muted_user_id = n.user_id
       )
       or exists(
         select 1 from public.user_blocks b
          where b.blocker_user_id = v_uid and b.blocked_user_id = n.user_id
       )
     );

  return v_result;
end
$$;

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
         and (
           v_uid is null
           or (
             not exists(
               select 1 from public.user_mutes m
                where m.muter_user_id = v_uid and m.muted_user_id = c.user_id
             )
             and not exists(
               select 1 from public.user_blocks b
                where b.blocker_user_id = v_uid and b.blocked_user_id = c.user_id
             )
           )
         )
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
  v_author_id uuid;
  v_is_self_comment boolean := false;
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

  select n.id, n.user_id
    into v_novel_id, v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  v_is_self_comment := v_author_id = v_uid;

  if not v_is_self_comment and exists(
    select 1
      from public.user_blocks b
     where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
        or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
  ) then
    raise exception using errcode = '42501', message = 'DIRECT_INTERACTION_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:comment-xp:' || v_uid::text, 0)
  );

  if not v_is_self_comment then
    select exists (
      select 1
        from public.scout_event_ledger e
       where e.user_id = v_uid
         and e.novel_id_snapshot = p_novel_id
         and e.event_type = 'comment_posted'
         and coalesce(e.metadata ->> 'xp_eligible', 'true') = 'true'
         and pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
             = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date
    ) into v_had_work_today;
  end if;

  insert into public.novel_comments(id, novel_id, user_id, body, created_at)
  values (v_comment_id, v_novel_id, v_uid, v_body, v_event_at);

  insert into public.scout_event_ledger(
    id, user_id, event_type, event_key, novel_id_snapshot, occurred_at, metadata
  ) values (
    v_event_id,
    v_uid,
    'comment_posted',
    'comment_posted:' || v_comment_id::text,
    p_novel_id,
    v_event_at,
    pg_catalog.jsonb_build_object(
      'comment_id', v_comment_id,
      'novel_author_id', v_author_id,
      'xp_eligible', not v_is_self_comment
    )
  );

  if not v_is_self_comment and not v_had_work_today then
    select count(*)::integer
      into v_awarded_today
      from public.scout_xp_ledger x
     where x.user_id = v_uid
       and x.xp_kind = 'comment'
       and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
           = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date;

    if v_awarded_today < 3 then
      insert into public.scout_xp_ledger(
        user_id, source_event_id, xp_kind, xp_value, rule_version, occurred_at
      ) values (
        v_uid, v_event_id, 'comment', 5, 'beta-v1', v_event_at
      )
      on conflict (user_id, source_event_id, xp_kind) do nothing;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('id', v_comment_id, 'created_at', v_event_at);
end
$$;

revoke all on function public.novelight_user_relationship(uuid) from public, anon;
revoke all on function public.novelight_set_user_block(uuid, boolean) from public, anon;
revoke all on function public.novelight_set_user_mute(uuid, boolean) from public, anon;
revoke all on function public.novelight_hidden_novel_ids(text[]) from public, anon;
revoke all on function public.novelight_comment_feed(text, integer) from public;
revoke all on function public.post_novel_comment(text, text) from public, anon;

grant execute on function public.novelight_user_relationship(uuid) to authenticated;
grant execute on function public.novelight_set_user_block(uuid, boolean) to authenticated;
grant execute on function public.novelight_set_user_mute(uuid, boolean) to authenticated;
grant execute on function public.novelight_hidden_novel_ids(text[]) to authenticated;
grant execute on function public.novelight_comment_feed(text, integer) to anon, authenticated;
grant execute on function public.post_novel_comment(text, text) to authenticated;

commit;
