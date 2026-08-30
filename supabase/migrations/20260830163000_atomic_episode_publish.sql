-- NOVELIGHT: publish an episode and, when necessary, publish its novel in one
-- database transaction. This removes the client-side partial-success window.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260830163000'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must be enabled on novels and episodes';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'novels'
      and policyname = 'novelrise_novels_update_owner'
      and cmd = 'UPDATE'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_insert_owner'
      and cmd = 'INSERT'
  ) then
    raise exception 'Required owner write policies are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.novels'::regclass
      and tgname = 'novels_lock_first_publication_time'
      and not tgisinternal
  ) then
    raise exception 'First-publication timestamp trigger is missing';
  end if;

  if to_regprocedure(
    'public.novelight_publish_episode_atomic(bigint,bigint,text,text)'
  ) is not null then
    raise exception 'novelight_publish_episode_atomic already exists';
  end if;
end
$$;

create function public.novelight_publish_episode_atomic(
  p_novel_id bigint,
  p_episode_number bigint,
  p_title text,
  p_content text
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_status text;
  v_episode_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  -- Lock the owned novel so concurrent first-episode submissions cannot race
  -- the first-publication transition. SECURITY INVOKER keeps existing RLS in
  -- force, while the explicit user_id predicate prevents authority widening.
  select n.status
  into v_novel_status
  from public.novels n
  where n.id = p_novel_id
    and n.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Novel not found or not owned by current user'
      using errcode = '42501';
  end if;

  if v_novel_status <> 'published' then
    update public.novels
    set status = 'published'
    where id = p_novel_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Novel could not be published by current user'
        using errcode = '42501';
    end if;
  end if;

  -- If this INSERT fails (for example, duplicate episode_number), PostgreSQL
  -- rolls back the earlier novel publication and its first-publication trigger
  -- side effects as part of the same RPC transaction.
  insert into public.episodes (
    novel_id,
    user_id,
    episode_number,
    title,
    content,
    status,
    pv
  ) values (
    p_novel_id,
    v_user_id,
    p_episode_number,
    p_title,
    p_content,
    'published',
    0
  )
  returning id into v_episode_id;

  return v_episode_id;
end
$$;

revoke all on function public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
) from public;
revoke all on function public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
) from anon;
grant execute on function public.novelight_publish_episode_atomic(
  bigint,
  bigint,
  text,
  text
) to authenticated;

commit;
