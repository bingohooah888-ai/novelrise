-- NOVELIGHT competitor audit B #14: author comment moderation.
--
-- Adds a deliberately small author moderation surface:
-- - pin at most one visible comment per work
-- - soft-hide / unhide with a bounded reason
-- - one author reply per reader comment
-- All actions are audited privately and do not rewrite comment/SCOUT history.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918192000'));

do $$
begin
  if to_regclass('public.novel_comments') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.profiles') is null then
    raise exception 'B #14 requires the existing comment, novel, and profile foundations';
  end if;

  if to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.delete_novel_comment(uuid)') is null then
    raise exception 'B #14 requires the existing comment runtime';
  end if;

  if to_regclass('public.user_mutes') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'B #14 requires the existing block/mute comment feed contract';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='novel_comments'
       and column_name in (
         'author_hidden_at',
         'author_hidden_reason',
         'pinned_at',
         'author_reply_body',
         'author_reply_at',
         'author_reply_updated_at'
       )
  ) then
    raise exception 'B #14 comment moderation columns already exist';
  end if;

  if to_regclass('public.novel_comment_moderation_events') is not null
     or to_regprocedure('public.novelight_set_comment_pin(uuid,boolean)') is not null
     or to_regprocedure('public.novelight_set_comment_hidden(uuid,boolean,text)') is not null
     or to_regprocedure('public.novelight_set_comment_author_reply(uuid,text)') is not null then
    raise exception 'B #14 comment moderation runtime already exists';
  end if;
end
$$;

alter table public.novel_comments
  add column author_hidden_at timestamptz,
  add column author_hidden_reason text,
  add column pinned_at timestamptz,
  add column author_reply_body text,
  add column author_reply_at timestamptz,
  add column author_reply_updated_at timestamptz;

alter table public.novel_comments
  add constraint novel_comments_author_hidden_reason_valid
    check (
      (author_hidden_at is null and author_hidden_reason is null)
      or (
        author_hidden_at is not null
        and author_hidden_reason in (
          'spoiler',
          'harassment',
          'privacy',
          'off_topic',
          'other'
        )
      )
    ),
  add constraint novel_comments_author_reply_body_valid
    check (
      author_reply_body is null
      or pg_catalog.char_length(pg_catalog.btrim(author_reply_body)) between 1 and 2000
    ),
  add constraint novel_comments_author_reply_timestamps_valid
    check (
      (author_reply_body is null and author_reply_at is null and author_reply_updated_at is null)
      or (
        author_reply_body is not null
        and author_reply_at is not null
        and author_reply_updated_at is not null
      )
    );

create unique index novel_comments_one_visible_pin_per_novel_idx
  on public.novel_comments (novel_id)
  where pinned_at is not null
    and deleted_at is null
    and author_hidden_at is null;

create table public.novel_comment_moderation_events (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.novel_comments(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (
    action in ('pin','unpin','hide','unhide','reply_set','reply_removed')
  ),
  reason text,
  occurred_at timestamptz not null default now()
);

create index novel_comment_moderation_events_comment_idx
  on public.novel_comment_moderation_events (comment_id, occurred_at desc);
create index novel_comment_moderation_events_novel_idx
  on public.novel_comment_moderation_events (novel_id, occurred_at desc);

alter table public.novel_comment_moderation_events enable row level security;
revoke all on table public.novel_comment_moderation_events
  from public, anon, authenticated, service_role;

create or replace function public.novelight_set_comment_pin(
  p_comment_id uuid,
  p_pinned boolean
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
  v_comment_user_id uuid;
  v_deleted_at timestamptz;
  v_hidden_at timestamptz;
  v_pinned_at timestamptz;
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select c.novel_id, n.user_id
    into v_novel_id, v_author_id
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.id = p_comment_id;

  if not found or v_author_id <> v_uid then
    raise exception using errcode='42501', message='Author moderation unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:comment-moderation:' || v_novel_id::text, 0)
  );

  select c.user_id, n.user_id, c.deleted_at, c.author_hidden_at, c.pinned_at
    into v_comment_user_id, v_author_id, v_deleted_at, v_hidden_at, v_pinned_at
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.id = p_comment_id
     and c.novel_id = v_novel_id
   for update of c;

  if not found or v_author_id <> v_uid then
    raise exception using errcode='42501', message='Author moderation unavailable';
  end if;

  if v_comment_user_id = v_uid then
    raise exception using errcode='22023', message='Only reader comments can be moderated';
  end if;

  if p_pinned then
    if v_deleted_at is not null or v_hidden_at is not null then
      raise exception using errcode='22023', message='Only visible active comments can be pinned';
    end if;

    insert into public.novel_comment_moderation_events(
      comment_id, novel_id, author_user_id, action, occurred_at
    )
    select c.id, c.novel_id, v_uid, 'unpin', v_now
      from public.novel_comments c
     where c.novel_id = v_novel_id
       and c.id <> p_comment_id
       and c.pinned_at is not null
       and c.deleted_at is null
       and c.author_hidden_at is null;

    update public.novel_comments
       set pinned_at = null
     where novel_id = v_novel_id
       and id <> p_comment_id
       and pinned_at is not null;

    if v_pinned_at is null then
      update public.novel_comments
         set pinned_at = v_now
       where id = p_comment_id;

      insert into public.novel_comment_moderation_events(
        comment_id, novel_id, author_user_id, action, occurred_at
      ) values (
        p_comment_id, v_novel_id, v_uid, 'pin', v_now
      );
    end if;
  elsif v_pinned_at is not null then
    update public.novel_comments
       set pinned_at = null
     where id = p_comment_id;

    insert into public.novel_comment_moderation_events(
      comment_id, novel_id, author_user_id, action, occurred_at
    ) values (
      p_comment_id, v_novel_id, v_uid, 'unpin', v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'comment_id', p_comment_id,
    'pinned', coalesce(p_pinned, false)
  );
end
$$;

create or replace function public.novelight_set_comment_hidden(
  p_comment_id uuid,
  p_hidden boolean,
  p_reason text default null
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
  v_comment_user_id uuid;
  v_deleted_at timestamptz;
  v_hidden_at timestamptz;
  v_pinned_at timestamptz;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select c.novel_id, n.user_id
    into v_novel_id, v_author_id
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.id = p_comment_id;

  if not found or v_author_id <> v_uid then
    raise exception using errcode='42501', message='Author moderation unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:comment-moderation:' || v_novel_id::text, 0)
  );

  select c.user_id, n.user_id, c.deleted_at, c.author_hidden_at, c.pinned_at
    into v_comment_user_id, v_author_id, v_deleted_at, v_hidden_at, v_pinned_at
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.id = p_comment_id
     and c.novel_id = v_novel_id
   for update of c;

  if not found or v_author_id <> v_uid then
    raise exception using errcode='42501', message='Author moderation unavailable';
  end if;

  if v_comment_user_id = v_uid then
    raise exception using errcode='22023', message='Only reader comments can be moderated';
  end if;

  if v_deleted_at is not null then
    raise exception using errcode='22023', message='Deleted comments cannot be moderated';
  end if;

  if p_hidden then
    if v_reason not in ('spoiler','harassment','privacy','off_topic','other') then
      raise exception using errcode='22023', message='A valid moderation reason is required';
    end if;

    update public.novel_comments
       set author_hidden_at = coalesce(author_hidden_at, v_now),
           author_hidden_reason = v_reason,
           pinned_at = null
     where id = p_comment_id;

    if v_pinned_at is not null then
      insert into public.novel_comment_moderation_events(
        comment_id, novel_id, author_user_id, action, occurred_at
      ) values (
        p_comment_id, v_novel_id, v_uid, 'unpin', v_now
      );
    end if;

    insert into public.novel_comment_moderation_events(
      comment_id, novel_id, author_user_id, action, reason, occurred_at
    ) values (
      p_comment_id, v_novel_id, v_uid, 'hide', v_reason, v_now
    );
  elsif v_hidden_at is not null then
    update public.novel_comments
       set author_hidden_at = null,
           author_hidden_reason = null
     where id = p_comment_id;

    insert into public.novel_comment_moderation_events(
      comment_id, novel_id, author_user_id, action, occurred_at
    ) values (
      p_comment_id, v_novel_id, v_uid, 'unhide', v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'comment_id', p_comment_id,
    'hidden', coalesce(p_hidden, false)
  );
end
$$;

create or replace function public.novelight_set_comment_author_reply(
  p_comment_id uuid,
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
  v_comment_user_id uuid;
  v_deleted_at timestamptz;
  v_hidden_at timestamptz;
  v_existing_body text;
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select
    c.novel_id,
    n.user_id,
    c.user_id,
    c.deleted_at,
    c.author_hidden_at,
    c.author_reply_body
    into
      v_novel_id,
      v_author_id,
      v_comment_user_id,
      v_deleted_at,
      v_hidden_at,
      v_existing_body
    from public.novel_comments c
    join public.novels n on n.id = c.novel_id
   where c.id = p_comment_id
   for update of c;

  if not found or v_author_id <> v_uid then
    raise exception using errcode='42501', message='Author reply unavailable';
  end if;

  if v_body is not null then
    if v_comment_user_id = v_uid then
      raise exception using errcode='22023', message='Authors cannot reply to their own comment';
    end if;
    if v_deleted_at is not null or v_hidden_at is not null then
      raise exception using errcode='22023', message='Only visible active comments can receive an author reply';
    end if;
    if exists (
      select 1
        from public.user_blocks b
       where (b.blocker_user_id = v_uid and b.blocked_user_id = v_comment_user_id)
          or (b.blocker_user_id = v_comment_user_id and b.blocked_user_id = v_uid)
    ) then
      raise exception using errcode='42501', message='DIRECT_INTERACTION_UNAVAILABLE';
    end if;
    if pg_catalog.char_length(v_body) > 2000 then
      raise exception using errcode='22023', message='Author reply must be 2000 characters or fewer';
    end if;

    update public.novel_comments
       set author_reply_body = v_body,
           author_reply_at = coalesce(author_reply_at, v_now),
           author_reply_updated_at = v_now
     where id = p_comment_id;

    insert into public.novel_comment_moderation_events(
      comment_id, novel_id, author_user_id, action, occurred_at
    ) values (
      p_comment_id, v_novel_id, v_uid, 'reply_set', v_now
    );
  elsif v_existing_body is not null then
    update public.novel_comments
       set author_reply_body = null,
           author_reply_at = null,
           author_reply_updated_at = null
     where id = p_comment_id;

    insert into public.novel_comment_moderation_events(
      comment_id, novel_id, author_user_id, action, occurred_at
    ) values (
      p_comment_id, v_novel_id, v_uid, 'reply_removed', v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'comment_id', p_comment_id,
    'has_reply', v_body is not null
  );
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
  v_author_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  select n.id, n.user_id
    into v_novel_id, v_author_id
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
        'can_delete', q.user_id = v_uid,
        'can_moderate', v_uid = v_author_id and q.user_id <> v_author_id,
        'is_pinned', q.pinned_at is not null and q.author_hidden_at is null,
        'is_hidden', q.author_hidden_at is not null,
        'hidden_reason',
          case when v_uid = v_author_id then q.author_hidden_reason else null end,
        'author_reply_body',
          case when q.author_reply_visible then q.author_reply_body else null end,
        'author_reply_at',
          case when q.author_reply_visible then q.author_reply_at else null end,
        'author_reply_updated_at',
          case when q.author_reply_visible then q.author_reply_updated_at else null end
      )
      order by
        (q.pinned_at is not null and q.author_hidden_at is null) desc,
        q.pinned_at desc nulls last,
        q.created_at desc,
        q.id desc
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select
        c.id,
        c.user_id,
        p.display_name,
        c.body,
        c.created_at,
        c.author_hidden_at,
        c.author_hidden_reason,
        c.pinned_at,
        c.author_reply_body,
        c.author_reply_at,
        c.author_reply_updated_at,
        case
          when c.author_reply_body is null then false
          when v_uid is null or v_uid = v_author_id then true
          when exists (
            select 1
              from public.user_blocks rb
             where (rb.blocker_user_id = v_uid and rb.blocked_user_id = v_author_id)
                or (rb.blocker_user_id = v_author_id and rb.blocked_user_id = v_uid)
          ) then false
          else true
        end as author_reply_visible
        from public.novel_comments c
        join public.profiles p on p.id = c.user_id
       where c.novel_id = v_novel_id
         and c.deleted_at is null
         and (
           c.author_hidden_at is null
           or v_uid = c.user_id
           or v_uid = v_author_id
         )
         and (
           v_uid is null
           or (
             not exists(
               select 1 from public.user_mutes m
                where m.muter_user_id = v_uid
                  and m.muted_user_id = c.user_id
             )
             and not exists(
               select 1 from public.user_blocks b
                where b.blocker_user_id = v_uid
                  and b.blocked_user_id = c.user_id
             )
           )
         )
       order by
         (c.pinned_at is not null and c.author_hidden_at is null) desc,
         c.pinned_at desc nulls last,
         c.created_at desc,
         c.id desc
       limit v_limit
    ) q;

  return v_result;
end
$$;

revoke all on function public.novelight_set_comment_pin(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_comment_hidden(uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_comment_author_reply(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_comment_feed(text, integer)
  from public;

grant execute on function public.novelight_set_comment_pin(uuid, boolean)
  to authenticated;
grant execute on function public.novelight_set_comment_hidden(uuid, boolean, text)
  to authenticated;
grant execute on function public.novelight_set_comment_author_reply(uuid, text)
  to authenticated;
grant execute on function public.novelight_comment_feed(text, integer)
  to anon, authenticated;

comment on column public.novel_comments.author_hidden_at is
  'B #14 author soft-moderation state. Does not delete comment or alter SCOUT/Rank history.';
comment on column public.novel_comments.pinned_at is
  'B #14 presentation-only author pin. Never used as Rank, SCOUT, PV, favorites, discovery, or exposure input.';
comment on column public.novel_comments.author_reply_body is
  'B #14 single author reply. Does not create reader comment EXP or evaluation signals.';
comment on table public.novel_comment_moderation_events is
  'Private B #14 author moderation audit trail. Not an evaluation, Rank, SCOUT, discovery, or exposure signal.';
comment on function public.novelight_set_comment_pin(uuid, boolean) is
  'B #14 owner-only presentation pin. Never changes comment/SCOUT evaluation history.';
comment on function public.novelight_set_comment_hidden(uuid, boolean, text) is
  'B #14 owner-only soft hide/unhide with bounded reason and private audit trail.';
comment on function public.novelight_set_comment_author_reply(uuid, text) is
  'B #14 owner-only single reply. No SCOUT EXP, Rank, or exposure effects.';

commit;
