-- Episode hearts: lightweight per-episode positive reactions.
-- Independent from Rank, LIGHT SEED, SCOUT, PV, favorites, discovery, and exposure.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920082032'));

do $$
begin
  if to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'NOVELIGHT episode, novel, and block foundations are required';
  end if;
end
$$;

create table public.episode_hearts (
  episode_id bigint not null references public.episodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);

create index episode_hearts_user_id_idx
  on public.episode_hearts (user_id);

alter table public.episode_hearts enable row level security;
revoke all on table public.episode_hearts from public, anon, authenticated;

create or replace function public.novelight_episode_heart_state(p_episode_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_count bigint := 0;
  v_hearted boolean := false;
  v_can_heart boolean := false;
begin
  if p_episode_id is null or p_episode_id <= 0 then
    return pg_catalog.jsonb_build_object(
      'available', false,
      'heart_count', 0,
      'hearted', false,
      'can_heart', false
    );
  end if;

  select e.user_id
    into v_author_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    return pg_catalog.jsonb_build_object(
      'available', false,
      'heart_count', 0,
      'hearted', false,
      'can_heart', false
    );
  end if;

  select count(*)::bigint
    into v_count
    from public.episode_hearts h
   where h.episode_id = p_episode_id;

  if v_uid is not null then
    select exists(
      select 1
        from public.episode_hearts h
       where h.episode_id = p_episode_id
         and h.user_id = v_uid
    ) into v_hearted;

    v_can_heart :=
      v_uid <> v_author_id
      and not exists(
        select 1
          from public.user_blocks b
         where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
            or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
      );
  end if;

  return pg_catalog.jsonb_build_object(
    'available', true,
    'heart_count', v_count,
    'hearted', v_hearted,
    'can_heart', v_can_heart
  );
end
$$;

create or replace function public.novelight_toggle_episode_heart(p_episode_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_hearted boolean;
  v_count bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_episode_id is null or p_episode_id <= 0 then
    raise exception using errcode = '22023', message = 'Invalid episode';
  end if;

  select e.user_id
    into v_author_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = 'EPISODE_HEART_UNAVAILABLE';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = 'EPISODE_HEART_SELF_NOT_ALLOWED';
  end if;

  if exists(
    select 1
      from public.user_blocks b
     where (b.blocker_user_id = v_author_id and b.blocked_user_id = v_uid)
        or (b.blocker_user_id = v_uid and b.blocked_user_id = v_author_id)
  ) then
    raise exception using errcode = '42501', message = 'DIRECT_INTERACTION_UNAVAILABLE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:episode-heart:' || p_episode_id::text || ':' || v_uid::text,
      0
    )
  );

  if exists(
    select 1
      from public.episode_hearts h
     where h.episode_id = p_episode_id
       and h.user_id = v_uid
  ) then
    delete from public.episode_hearts
     where episode_id = p_episode_id
       and user_id = v_uid;
    v_hearted := false;
  else
    insert into public.episode_hearts(episode_id, user_id)
    values (p_episode_id, v_uid);
    v_hearted := true;
  end if;

  select count(*)::bigint
    into v_count
    from public.episode_hearts h
   where h.episode_id = p_episode_id;

  return pg_catalog.jsonb_build_object(
    'episode_id', p_episode_id,
    'hearted', v_hearted,
    'heart_count', v_count
  );
end
$$;

revoke all on function public.novelight_episode_heart_state(bigint)
  from public, anon, authenticated;
revoke all on function public.novelight_toggle_episode_heart(bigint)
  from public, anon, authenticated;

grant execute on function public.novelight_episode_heart_state(bigint)
  to anon, authenticated;
grant execute on function public.novelight_toggle_episode_heart(bigint)
  to authenticated;

comment on table public.episode_hearts is
  'Private per-user episode reactions. Never an input to Rank, LIGHT SEED, SCOUT, PV, favorites, discovery, or exposure.';
comment on function public.novelight_episode_heart_state(bigint) is
  'Returns only public aggregate count plus current-caller state; never exposes heart sender identities.';
comment on function public.novelight_toggle_episode_heart(bigint) is
  'Authenticated toggle for one published episode; blocks self-heart and blocked direct interaction.';

commit;
