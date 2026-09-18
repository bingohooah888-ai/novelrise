-- NOVELIGHT competitor audit #16: draft-only limited share links.
--
-- Limited sharing is intentionally separated from normal publication.
-- A shared work remains novels.status = 'draft', so normal RLS, discovery,
-- Rank, SCOUT, LIGHT SEED, PV, favorites, search, and exposure continue to
-- treat it as non-public. Access is only through token-bound RPCs.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918225815'));

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.profiles') is null then
    raise exception 'B #16 requires the existing novel/episode/profile foundation';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'B #16 requires novels/episodes RLS to remain enabled';
  end if;

  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'B #16 requires pg_catalog.sha256(bytea)';
  end if;

  if to_regclass('public.novel_share_links') is not null
     or to_regprocedure('public.novelight_share_link_status(bigint)') is not null
     or to_regprocedure('public.novelight_rotate_share_link(bigint)') is not null
     or to_regprocedure('public.novelight_revoke_share_link(bigint)') is not null
     or to_regprocedure('public.novelight_shared_novel(text)') is not null
     or to_regprocedure('public.novelight_shared_episode(text,bigint)') is not null then
    raise exception 'B #16 limited-share runtime already exists';
  end if;
end
$$;

create table public.novel_share_links (
  novel_id bigint primary key
    references public.novels(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

comment on table public.novel_share_links is
  'B #16 draft-only share-link secrets. Raw token material is never stored.';

alter table public.novel_share_links enable row level security;

revoke all on table public.novel_share_links from public, anon, authenticated, service_role;

create or replace function public.novelight_share_link_status(
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_created_at timestamptz;
  v_rotated_at timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.status
    into v_status
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode = '42501', message = 'Novel not found or not owned by current user';
  end if;

  select s.created_at, s.rotated_at
    into v_created_at, v_rotated_at
    from public.novel_share_links s
   where s.novel_id = p_novel_id;

  return pg_catalog.jsonb_build_object(
    'eligible', v_status = 'draft',
    'enabled', v_status = 'draft' and v_created_at is not null,
    'created_at', v_created_at,
    'rotated_at', v_rotated_at
  );
end
$$;

create or replace function public.novelight_rotate_share_link(
  p_novel_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_hash bytea;
  v_created_at timestamptz;
  v_rotated_at timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
     and n.status = 'draft'
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'SHARE_ONLY_DRAFT: only an owned draft work can be shared';
  end if;

  v_token :=
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
    || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8'));

  insert into public.novel_share_links (
    novel_id,
    token_hash,
    created_at,
    rotated_at
  ) values (
    p_novel_id,
    v_hash,
    v_rotated_at,
    v_rotated_at
  )
  on conflict (novel_id) do update
    set token_hash = excluded.token_hash,
        rotated_at = excluded.rotated_at
  returning created_at, rotated_at
    into v_created_at, v_rotated_at;

  return pg_catalog.jsonb_build_object(
    'token', v_token,
    'created_at', v_created_at,
    'rotated_at', v_rotated_at
  );
end
$$;

create or replace function public.novelight_revoke_share_link(
  p_novel_id bigint
)
returns boolean
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

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode = '42501', message = 'Novel not found or not owned by current user';
  end if;

  delete from public.novel_share_links s
   where s.novel_id = p_novel_id;

  return found;
end
$$;

create or replace function public.novelight_shared_novel(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_result jsonb;
begin
  if p_token is null
     or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  select pg_catalog.jsonb_build_object(
    'title', n.title,
    'description', n.description,
    'genre', n.genre,
    'content_rating', n.content_rating,
    'content_warnings', n.content_warnings,
    'author_name', p.display_name,
    'episodes', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'episode_number', e.episode_number,
            'title', e.title
          )
          order by e.episode_number, e.id
        )
          from public.episodes e
         where e.novel_id = n.id
           and e.episode_number is not null
      ),
      '[]'::jsonb
    )
  )
    into v_result
    from public.novel_share_links s
    join public.novels n on n.id = s.novel_id
    left join public.profiles p on p.id = n.user_id
   where s.token_hash = v_hash
     and n.status = 'draft';

  return v_result;
end
$$;

create or replace function public.novelight_shared_episode(
  p_token text,
  p_episode_number bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_novel_id bigint;
  v_novel_title text;
  v_episode_id bigint;
  v_episode_title text;
  v_episode_content text;
  v_previous bigint;
  v_next bigint;
begin
  if p_token is null
     or p_token !~ '^[0-9a-f]{64}$'
     or p_episode_number is null
     or p_episode_number < 1 then
    return null;
  end if;

  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  select n.id, n.title
    into v_novel_id, v_novel_title
    from public.novel_share_links s
    join public.novels n on n.id = s.novel_id
   where s.token_hash = v_hash
     and n.status = 'draft';

  if not found then
    return null;
  end if;

  select e.id, e.title, e.content
    into v_episode_id, v_episode_title, v_episode_content
    from public.episodes e
   where e.novel_id = v_novel_id
     and e.episode_number = p_episode_number
   order by e.id
   limit 1;

  if not found then
    return null;
  end if;

  select max(e.episode_number)
    into v_previous
    from public.episodes e
   where e.novel_id = v_novel_id
     and e.episode_number < p_episode_number;

  select min(e.episode_number)
    into v_next
    from public.episodes e
   where e.novel_id = v_novel_id
     and e.episode_number > p_episode_number;

  return pg_catalog.jsonb_build_object(
    'novel_title', v_novel_title,
    'episode_number', p_episode_number,
    'title', v_episode_title,
    'content', coalesce(v_episode_content, ''),
    'previous_episode_number', v_previous,
    'next_episode_number', v_next
  );
end
$$;

create or replace function public._novelight_revoke_share_link_when_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'draft'
     or new.user_id is distinct from old.user_id then
    delete from public.novel_share_links s
     where s.novel_id = new.id;
  end if;

  return new;
end
$$;

create trigger novelight_revoke_share_link_when_public
after update of status, user_id on public.novels
for each row
when (
  old.status is distinct from new.status
  or old.user_id is distinct from new.user_id
)
execute function public._novelight_revoke_share_link_when_public();

revoke all on function public.novelight_share_link_status(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_share_link_status(bigint)
  to authenticated;

revoke all on function public.novelight_rotate_share_link(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_rotate_share_link(bigint)
  to authenticated;

revoke all on function public.novelight_revoke_share_link(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_revoke_share_link(bigint)
  to authenticated;

revoke all on function public.novelight_shared_novel(text)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_shared_novel(text)
  to anon, authenticated;

revoke all on function public.novelight_shared_episode(text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_shared_episode(text, bigint)
  to anon, authenticated;

revoke all on function public._novelight_revoke_share_link_when_public()
  from public, anon, authenticated, service_role;

comment on function public.novelight_shared_novel(text) is
  'B #16 intentional public token endpoint for draft review. Returns no raw secret, IDs, PV, Rank, SCOUT, favorites, or exposure state.';

comment on function public.novelight_shared_episode(text, bigint) is
  'B #16 intentional public token endpoint for draft episode review. Does not increment PV or create reader/SCOUT events.';

commit;
