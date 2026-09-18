-- NOVELIGHT competitor audit B #15: reader-authored spoiler display.
--
-- Spoiler state is presentation-only. It must not affect SCOUT EXP, Rank,
-- LIGHT SEED, PV, favorites, discovery, or exposure.
-- The existing post_novel_comment RPC remains the source of truth for
-- authentication, block boundaries, comment creation, and SCOUT EXP.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918221621'));

do $$
begin
  if to_regclass('public.novel_comments') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.profiles') is null then
    raise exception 'B #15 requires the existing comment foundation';
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.novelight_set_comment_hidden(uuid,boolean,text)') is null then
    raise exception 'B #15 requires the current B #14 comment runtime';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_comments'
       and column_name = 'author_hidden_at'
  ) then
    raise exception 'B #15 requires B #14 moderation state';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_comments'
       and column_name = 'is_spoiler'
  ) or to_regprocedure(
    'public.novelight_post_novel_comment(text,text,boolean)'
  ) is not null then
    raise exception 'B #15 spoiler runtime already exists';
  end if;
end
$$;

alter table public.novel_comments
  add column is_spoiler boolean not null default false;

comment on column public.novel_comments.is_spoiler is
  'B #15 reader-authored presentation-only spoiler flag. Never used for SCOUT, Rank, PV, favorites, discovery, or exposure.';

create or replace function public.novelight_post_novel_comment(
  p_novel_id text,
  p_body text,
  p_is_spoiler boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
  v_comment_id uuid;
  v_is_spoiler boolean := coalesce(p_is_spoiler, false);
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  v_result := public.post_novel_comment(p_novel_id, p_body);
  v_comment_id := nullif(v_result ->> 'id', '')::uuid;

  if v_comment_id is null then
    raise exception 'Comment creation did not return an id';
  end if;

  update public.novel_comments
     set is_spoiler = v_is_spoiler
   where id = v_comment_id
     and user_id = v_uid
     and deleted_at is null;

  if not found then
    raise exception using errcode = '42501', message = 'Comment spoiler state unavailable';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'is_spoiler',
    v_is_spoiler
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
        'is_spoiler', q.is_spoiler,
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
        c.is_spoiler,
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

revoke all on function public.novelight_post_novel_comment(text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_post_novel_comment(text, text, boolean)
  to authenticated;

revoke all on function public.novelight_comment_feed(text, integer) from public;
grant execute on function public.novelight_comment_feed(text, integer)
  to anon, authenticated;

comment on function public.novelight_post_novel_comment(text, text, boolean) is
  'B #15 atomic comment post plus presentation-only spoiler flag. Existing post_novel_comment remains the source of comment safety and SCOUT EXP logic.';

commit;
