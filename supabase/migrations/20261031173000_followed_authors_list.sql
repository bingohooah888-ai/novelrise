-- Account-scoped following list for the bookshelf and community entry points.
-- Author follows remain private; this RPC reveals only the caller's own relationships.
begin;

do $$
begin
  if to_regprocedure('public.novelight_followers(integer,integer)') is not null
     or to_regprocedure('public.novelight_follow_counts()') is not null then
    raise exception 'Follower RPC already exists; inspect before applying';
  end if;
  if to_regprocedure('public.novelight_followed_authors(integer,integer)') is not null then
    raise exception 'Followed authors list RPC already exists; inspect before applying';
  end if;
end
$$;

create function public.novelight_followed_authors(
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(t.item order by t.followed_at desc, t.author_user_id),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      f.author_user_id,
      f.created_at as followed_at,
      pg_catalog.jsonb_build_object(
        'author_user_id', f.author_user_id::text,
        'display_name', coalesce(p.display_name, '名前未設定'),
        'avatar_path', p.avatar_path,
        'notify_new_works', f.notify_new_works,
        'notify_updates', f.notify_updates,
        'followed_at', f.created_at
      ) as item
    from public.author_follows f
    join public.profiles p on p.id = f.author_user_id
    where f.follower_user_id = v_uid
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = v_uid and b.blocked_user_id = f.author_user_id)
           or (b.blocker_user_id = f.author_user_id and b.blocked_user_id = v_uid)
      )
    order by f.created_at desc, f.author_user_id
    limit v_limit offset v_offset
  ) t;

  return v_result;
end
$$;

revoke all on function public.novelight_followed_authors(integer,integer)
  from public, anon, authenticated;
grant execute on function public.novelight_followed_authors(integer,integer)
  to authenticated;


-- A follower is anyone who follows the signed-in user's author profile.
-- This never grants direct SELECT on the relationship table.
create function public.novelight_followers(
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(q.item order by q.followed_at desc, q.follower_user_id),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      f.follower_user_id,
      f.created_at as followed_at,
      pg_catalog.jsonb_build_object(
        'user_id', f.follower_user_id::text,
        'display_name', coalesce(p.display_name, '名前未設定'),
        'avatar_path', p.avatar_path,
        'followed_at', f.created_at
      ) as item
    from public.author_follows f
    join public.profiles p on p.id = f.follower_user_id
    where f.author_user_id = v_uid
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = v_uid and b.blocked_user_id = f.follower_user_id)
           or (b.blocker_user_id = f.follower_user_id and b.blocked_user_id = v_uid)
      )
    order by f.created_at desc, f.follower_user_id
    limit v_limit offset v_offset
  ) q;

  return v_result;
end
$$;

create function public.novelight_follow_counts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_followers bigint;
  v_following bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select pg_catalog.count(*) into v_followers
    from public.author_follows f
    where f.author_user_id = v_uid
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = v_uid and b.blocked_user_id = f.follower_user_id)
           or (b.blocker_user_id = f.follower_user_id and b.blocked_user_id = v_uid)
      );

  select pg_catalog.count(*) into v_following
    from public.author_follows f
    where f.follower_user_id = v_uid
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = v_uid and b.blocked_user_id = f.author_user_id)
           or (b.blocker_user_id = f.author_user_id and b.blocked_user_id = v_uid)
      );

  return pg_catalog.jsonb_build_object(
    'followers', v_followers,
    'following', v_following
  );
end
$$;

revoke all on function public.novelight_followers(integer,integer)
  from public, anon, authenticated;
revoke all on function public.novelight_follow_counts()
  from public, anon, authenticated;
grant execute on function public.novelight_followers(integer,integer)
  to authenticated;
grant execute on function public.novelight_follow_counts()
  to authenticated;

commit;
