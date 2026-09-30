-- Episode-scoped comments. Existing work-level comments remain episode_id IS NULL.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260930030000'));

alter table public.novel_comments
  add column episode_id bigint references public.episodes(id) on delete cascade;

create index novel_comments_episode_created_idx
  on public.novel_comments (episode_id, created_at desc)
  where episode_id is not null;

comment on column public.novel_comments.episode_id is
  'Episode scope for comments. NULL means the existing work-level comment.';

create or replace function public.novelight_comment_feed_scope(
  p_novel_id bigint,
  p_episode_id bigint,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  select n.user_id
    into v_author_id
    from public.novels n
   where n.id = p_novel_id
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
       where c.novel_id = p_novel_id
         and (
           (p_episode_id is null and c.episode_id is null)
           or c.episode_id = p_episode_id
         )
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
begin
  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    return '[]'::jsonb;
  end if;

  return public.novelight_comment_feed_scope(v_novel_id, null, p_limit);
end
$$;

create or replace function public.novelight_episode_comment_feed(
  p_episode_id text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode_id bigint;
  v_novel_id bigint;
begin
  select e.id, e.novel_id
    into v_episode_id, v_novel_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id::text = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    return '[]'::jsonb;
  end if;

  return public.novelight_comment_feed_scope(v_novel_id, v_episode_id, p_limit);
end
$$;

create or replace function public.novelight_post_episode_comment(
  p_episode_id text,
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
  v_episode_id bigint;
  v_novel_id bigint;
  v_result jsonb;
  v_comment_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select e.id, e.novel_id
    into v_episode_id, v_novel_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id::text = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開エピソードが見つかりません';
  end if;

  v_result := public.novelight_post_novel_comment(
    v_novel_id::text,
    p_body,
    coalesce(p_is_spoiler, false)
  );
  v_comment_id := nullif(v_result ->> 'id', '')::uuid;

  if v_comment_id is null then
    raise exception 'Comment creation did not return an id';
  end if;

  update public.novel_comments
     set episode_id = v_episode_id
   where id = v_comment_id
     and user_id = v_uid
     and novel_id = v_novel_id
     and deleted_at is null;

  if not found then
    raise exception using errcode = '42501', message = 'Episode comment scope unavailable';
  end if;

  return v_result || pg_catalog.jsonb_build_object('episode_id', v_episode_id);
end
$$;

revoke all on function public.novelight_comment_feed_scope(bigint, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_comment_feed(text, integer) from public;
grant execute on function public.novelight_comment_feed(text, integer)
  to anon, authenticated;
revoke all on function public.novelight_episode_comment_feed(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_episode_comment_feed(text, integer)
  to anon, authenticated;
revoke all on function public.novelight_post_episode_comment(text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_post_episode_comment(text, text, boolean)
  to authenticated;

commit;
