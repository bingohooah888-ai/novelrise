-- Favorite reading genres are optional and private unless the reader opts in.
-- Isolated from the core profiles table and its existing RPC signatures.
begin;

create table public.profile_favorite_genres (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  genres text[] not null default '{}'::text[],
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint profile_favorite_genres_max_three check (cardinality(genres) <= 3),
  constraint profile_favorite_genres_known check (
    genres <@ array[
      '異世界ファンタジー','現代ファンタジー','恋愛','ラブコメ','SF',
      'ミステリー','ホラー','歴史','現代ドラマ','その他'
    ]::text[]
  ),
  constraint profile_favorite_genres_no_null check (
    array_position(genres, null::text) is null
  ),
  constraint profile_favorite_genres_public_has_choice check (
    not is_public or cardinality(genres) > 0
  )
);

alter table public.profile_favorite_genres enable row level security;
create policy "Owner can read favorite genres" on public.profile_favorite_genres
  for select to authenticated using (user_id = (select auth.uid()));

-- Only SECURITY DEFINER RPCs may write. No direct client table access.
revoke all on table public.profile_favorite_genres from public, anon, authenticated;

create or replace function public.novelight_my_favorite_genres()
returns table(genres text[], is_public boolean)
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  return query
  select coalesce(p.genres, array[]::text[]), coalesce(p.is_public, false)
  from (select v_uid as uid) s
  left join public.profile_favorite_genres p on p.user_id = s.uid;
end;
$function$;

create or replace function public.novelight_set_my_favorite_genres(
  p_genres text[], p_is_public boolean default false
)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_genres text[] := coalesce(p_genres, array[]::text[]);
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if cardinality(v_genres) > 3
     or array_position(v_genres, null::text) is not null
     or not (
       v_genres <@ array[
         '異世界ファンタジー','現代ファンタジー','恋愛','ラブコメ','SF',
         'ミステリー','ホラー','歴史','現代ドラマ','その他'
       ]::text[]
     )
     or (
       select count(*) <> count(distinct genre)
       from unnest(v_genres) as choices(genre)
     )
  then
    raise exception using errcode='22023', message='Invalid favorite genres';
  end if;
  insert into public.profile_favorite_genres(user_id,genres,is_public,updated_at)
  values(v_uid,v_genres,coalesce(p_is_public,false) and cardinality(v_genres)>0,now())
  on conflict (user_id) do update
    set genres=excluded.genres,
        is_public=excluded.is_public,
        updated_at=excluded.updated_at;
  return true;
end;
$function$;

create or replace function public.novelight_public_favorite_genres(p_user_id uuid)
returns text[]
language sql stable security definer set search_path = ''
as $function$
  select coalesce((
    select p.genres from public.profile_favorite_genres p
    where p.user_id=p_user_id and p.is_public=true
      and exists (
        select 1 from public.novels n
        where n.user_id=p_user_id and n.status='published'
      )
    limit 1
  ),array[]::text[]);
$function$;

revoke all on function public.novelight_my_favorite_genres() from public,anon,authenticated;
revoke all on function public.novelight_set_my_favorite_genres(text[],boolean) from public,anon,authenticated;
revoke all on function public.novelight_public_favorite_genres(uuid) from public,anon,authenticated;
grant execute on function public.novelight_my_favorite_genres() to authenticated;
grant execute on function public.novelight_set_my_favorite_genres(text[],boolean) to authenticated;
grant execute on function public.novelight_public_favorite_genres(uuid) to anon,authenticated;

commit;
