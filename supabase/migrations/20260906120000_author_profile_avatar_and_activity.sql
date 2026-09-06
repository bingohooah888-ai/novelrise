begin;

select pg_advisory_xact_lock(hashtext('novelight:20260906120000'));

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_check;

alter table public.profiles
  add constraint profiles_avatar_path_check
  check (
    avatar_path is null
    or avatar_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$')
  );

-- Profile writes must never allow an authenticated browser to mutate billing columns.
revoke update on table public.profiles from anon, authenticated;

create or replace function public.novelight_update_my_public_profile(
  p_display_name text,
  p_bio text,
  p_avatar_path text default null
)
returns table (
  display_name text,
  bio text,
  avatar_path text
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := trim(coalesce(p_display_name, ''));
  v_bio text := coalesce(p_bio, '');
  v_avatar text := nullif(trim(coalesce(p_avatar_path, '')), '');
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if char_length(v_name) > 40 then
    raise exception using errcode = '22023', message = 'Display name is too long';
  end if;

  if char_length(v_bio) > 500 then
    raise exception using errcode = '22023', message = 'Bio is too long';
  end if;

  if v_avatar is not null
     and v_avatar !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$') then
    raise exception using errcode = '22023', message = 'Avatar path is invalid';
  end if;

  update public.profiles p
     set display_name = v_name,
         bio = v_bio,
         avatar_path = v_avatar
   where p.id = v_uid;

  if not found then
    raise exception using errcode = 'P0002', message = 'Profile not found';
  end if;

  return query
  select p.display_name, p.bio, p.avatar_path
    from public.profiles p
   where p.id = v_uid;
end
$$;

revoke all on function public.novelight_update_my_public_profile(text, text, text) from public, anon;
grant execute on function public.novelight_update_my_public_profile(text, text, text) to authenticated;

create or replace function public.novelight_author_recent_activity_v1(
  p_days integer default 30,
  p_limit integer default 10
)
returns table (
  activity_type text,
  occurred_at timestamptz,
  novel_id text,
  novel_title text,
  episode_number bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception using errcode = '22023', message = 'Activity window must be between 1 and 90 days';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception using errcode = '22023', message = 'Activity limit must be between 1 and 30';
  end if;

  return query
  with owned_novels as materialized (
    select n.id::text as novel_id, coalesce(nullif(trim(n.title), ''), 'タイトル未設定')::text as title
      from public.novels n
     where n.user_id = v_uid
  ),
  novel_published as (
    select
      'novel_published'::text as activity_type,
      n.first_published_at as occurred_at,
      n.id::text as novel_id,
      coalesce(nullif(trim(n.title), ''), 'タイトル未設定')::text as novel_title,
      null::bigint as episode_number
      from public.novels n
     where n.user_id = v_uid
       and n.first_published_at is not null
       and n.first_published_at >= now() - make_interval(days => p_days)
  ),
  episode_added as (
    select
      'episode_added'::text,
      e.created_at,
      e.novel_id::text,
      o.title,
      e.episode_number::bigint
      from public.episodes e
      join owned_novels o on o.novel_id = e.novel_id::text
     where e.user_id = v_uid
       and e.status = 'published'
       and e.created_at >= now() - make_interval(days => p_days)
  ),
  seeds_received as (
    select
      'light_seed_received'::text,
      s.seeded_at,
      s.novel_id_snapshot,
      coalesce(o.title, '削除済み作品')::text,
      null::bigint
      from public.light_seeds s
      left join owned_novels o on o.novel_id = s.novel_id_snapshot
     where s.author_id_snapshot = v_uid
       and s.seeded_at >= now() - make_interval(days => p_days)
  ),
  favorites_received as (
    select
      'favorite_added'::text,
      c.converted_at,
      c.novel_id_snapshot,
      coalesce(o.title, '削除済み作品')::text,
      null::bigint
      from public.novel_exposure_conversions c
      left join owned_novels o on o.novel_id = c.novel_id_snapshot
     where c.author_id_snapshot = v_uid
       and c.event_type = 'favorite_added'
       and c.converted_at >= now() - make_interval(days => p_days)
  ),
  first_episode_two_read as (
    select
      'first_episode_two_read'::text,
      min(c.converted_at) as occurred_at,
      c.novel_id_snapshot,
      coalesce(o.title, '削除済み作品')::text,
      2::bigint
      from public.novel_exposure_conversions c
      left join public.episodes ep on ep.id::text = c.episode_id_snapshot
      left join owned_novels o on o.novel_id = c.novel_id_snapshot
     where c.author_id_snapshot = v_uid
       and c.event_type = 'episode_read_10s'
       and coalesce(c.episode_number_snapshot, ep.episode_number) = 2
     group by c.novel_id_snapshot, o.title
    having min(c.converted_at) >= now() - make_interval(days => p_days)
  ),
  activity as (
    select * from novel_published
    union all select * from episode_added
    union all select * from seeds_received
    union all select * from favorites_received
    union all select * from first_episode_two_read
  )
  select a.activity_type, a.occurred_at, a.novel_id, a.novel_title, a.episode_number
    from activity a
   where a.occurred_at is not null
   order by a.occurred_at desc
   limit p_limit;
end
$$;

revoke all on function public.novelight_author_recent_activity_v1(integer, integer) from public, anon;
grant execute on function public.novelight_author_recent_activity_v1(integer, integer) to authenticated;

-- Supabase Storage is not installed in the isolated migration-replay fixture.
do $$
declare
  v_public boolean;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is unavailable; skipping avatar bucket bootstrap in compatibility replay';
    return;
  end if;

  insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  ) values (
    'author-avatars',
    'author-avatars',
    true,
    2097152,
    array['image/webp','image/png','image/jpeg']
  )
  on conflict (id) do nothing;

  select public into v_public
    from storage.buckets
   where id = 'author-avatars';

  if v_public is distinct from true then
    raise exception 'Existing author-avatars bucket is not public; inspect before continuing';
  end if;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects is unavailable; skipping avatar Storage policies in compatibility replay';
    return;
  end if;

  execute 'drop policy if exists "Author avatars insert own" on storage.objects';
  execute 'drop policy if exists "Author avatars delete own" on storage.objects';

  execute $policy$
    create policy "Author avatars insert own"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'author-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $policy$;

  execute $policy$
    create policy "Author avatars delete own"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'author-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $policy$;
end
$$;

commit;
