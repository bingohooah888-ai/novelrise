-- B #22: beta-safe collaborative writing with single-owner authority.
-- Collaboration never transfers ownership or grants publish/delete/billing/ranking powers.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919112318'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'B #22 requires profiles, novels, episodes, and user_blocks';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.episodes'::regclass) then
    raise exception 'B #22 requires novels and episodes RLS';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'B #22 requires pg_catalog.sha256(bytea)';
  end if;
  if to_regclass('public.novel_collaborators') is not null
     or to_regclass('public.novel_collaboration_invites') is not null
     or to_regclass('public.novel_collaboration_events') is not null then
    raise exception 'B #22 collaboration runtime already exists';
  end if;
end
$$;

create table public.novel_collaborators (
  novel_id bigint not null references public.novels(id) on delete cascade,
  collaborator_user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'editor',
  joined_at timestamptz not null default now(),
  primary key (novel_id, collaborator_user_id),
  constraint novel_collaborators_role_valid check (role = 'editor')
);

create index novel_collaborators_user_joined_idx
  on public.novel_collaborators (collaborator_user_id, joined_at desc, novel_id);

create table public.novel_collaboration_invites (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  token_hash bytea not null unique,
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint novel_collaboration_invites_expiry_valid check (expires_at > created_at)
);

create table public.novel_collaboration_events (
  id bigint generated always as identity primary key,
  novel_id bigint not null references public.novels(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  subject_user_id uuid references public.profiles(id) on delete set null,
  episode_id bigint references public.episodes(id) on delete set null,
  event_type text not null,
  created_at timestamptz not null default now(),
  constraint novel_collaboration_events_type_valid check (
    event_type in (
      'invite_rotated', 'invite_revoked', 'joined', 'removed', 'left',
      'episode_created', 'episode_edited'
    )
  )
);

create index novel_collaboration_events_novel_created_idx
  on public.novel_collaboration_events (novel_id, created_at desc, id desc);

alter table public.novel_collaborators enable row level security;
alter table public.novel_collaboration_invites enable row level security;
alter table public.novel_collaboration_events enable row level security;

revoke all on table public.novel_collaborators
  from public, anon, authenticated, service_role;
revoke all on table public.novel_collaboration_invites
  from public, anon, authenticated, service_role;
revoke all on table public.novel_collaboration_events
  from public, anon, authenticated, service_role;
revoke all on sequence public.novel_collaboration_events_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.novelight_collaboration_can_edit(
  p_novel_id bigint,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1
       from public.novels n
       where n.id = p_novel_id
         and (
           n.user_id = p_user_id
           or (
             exists (
               select 1
               from public.novel_collaborators c
               where c.novel_id = n.id
                 and c.collaborator_user_id = p_user_id
                 and c.role = 'editor'
             )
             and not exists (
               select 1
               from public.user_blocks b
               where (b.blocker_user_id = n.user_id and b.blocked_user_id = p_user_id)
                  or (b.blocker_user_id = p_user_id and b.blocked_user_id = n.user_id)
             )
           )
         )
     )
$$;

revoke all on function public.novelight_collaboration_can_edit(bigint,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.novelight_collaboration_access(p_novel_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel record;
  v_can_edit boolean;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select n.id, n.user_id, n.title, n.status
    into v_novel
    from public.novels n
   where n.id = p_novel_id;

  if not found then
    return null;
  end if;

  v_can_edit := public.novelight_collaboration_can_edit(p_novel_id, v_uid);

  if not v_can_edit then
    return pg_catalog.jsonb_build_object(
      'novel_id', p_novel_id,
      'can_edit', false,
      'can_manage', false,
      'is_owner', false
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'novel_id', v_novel.id,
    'title', v_novel.title,
    'status', v_novel.status,
    'owner_user_id', v_novel.user_id,
    'is_owner', v_novel.user_id = v_uid,
    'can_manage', v_novel.user_id = v_uid,
    'can_edit', true,
    'role', case when v_novel.user_id = v_uid then 'owner' else 'editor' end
  );
end
$$;

create or replace function public.novelight_list_my_collaborations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'novel_id', n.id,
      'title', n.title,
      'status', n.status,
      'owner_user_id', n.user_id,
      'owner_display_name', coalesce(p.display_name, '名前未設定'),
      'role', c.role,
      'joined_at', c.joined_at,
      'can_edit', public.novelight_collaboration_can_edit(n.id, v_uid)
    ) order by c.joined_at desc, n.id desc
  ), '[]'::jsonb)
    into v_result
    from public.novel_collaborators c
    join public.novels n on n.id = c.novel_id
    left join public.profiles p on p.id = n.user_id
   where c.collaborator_user_id = v_uid;

  return v_result;
end
$$;

create or replace function public.novelight_manage_novel_collaborators(p_novel_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite_expires timestamptz;
  v_members jsonb;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if not exists (
    select 1 from public.novels n
    where n.id = p_novel_id and n.user_id = v_uid
  ) then
    raise exception using errcode='42501', message='Novel not found or not owned by current user';
  end if;

  select i.expires_at into v_invite_expires
    from public.novel_collaboration_invites i
   where i.novel_id = p_novel_id
     and i.expires_at > pg_catalog.now();

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'user_id', c.collaborator_user_id,
      'display_name', coalesce(p.display_name, '名前未設定'),
      'role', c.role,
      'joined_at', c.joined_at
    ) order by c.joined_at, c.collaborator_user_id
  ), '[]'::jsonb)
    into v_members
    from public.novel_collaborators c
    left join public.profiles p on p.id = c.collaborator_user_id
   where c.novel_id = p_novel_id;

  return pg_catalog.jsonb_build_object(
    'members', v_members,
    'invite_active', v_invite_expires is not null,
    'invite_expires_at', v_invite_expires,
    'limit', 5
  );
end
$$;

create or replace function public.novelight_rotate_collaboration_invite(p_novel_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_hash bytea;
  v_expires timestamptz := pg_catalog.now() + interval '7 days';
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  perform 1 from public.novels n
   where n.id = p_novel_id and n.user_id = v_uid
   for update;
  if not found then
    raise exception using errcode='42501', message='Novel not found or not owned by current user';
  end if;

  if (select count(*) from public.novel_collaborators c where c.novel_id=p_novel_id) >= 5 then
    raise exception using errcode='22023', message='At most 5 collaborators are available during beta';
  end if;

  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
    || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8'));

  insert into public.novel_collaboration_invites (
    novel_id, token_hash, created_by_user_id, created_at, expires_at
  ) values (
    p_novel_id, v_hash, v_uid, pg_catalog.now(), v_expires
  )
  on conflict (novel_id) do update
    set token_hash=excluded.token_hash,
        created_by_user_id=excluded.created_by_user_id,
        created_at=excluded.created_at,
        expires_at=excluded.expires_at;

  insert into public.novel_collaboration_events (
    novel_id, actor_user_id, event_type
  ) values (p_novel_id, v_uid, 'invite_rotated');

  return pg_catalog.jsonb_build_object('token', v_token, 'expires_at', v_expires);
end
$$;

create or replace function public.novelight_revoke_collaboration_invite(p_novel_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if not exists (
    select 1 from public.novels n
    where n.id=p_novel_id and n.user_id=v_uid
  ) then
    raise exception using errcode='42501', message='Novel not found or not owned by current user';
  end if;

  delete from public.novel_collaboration_invites
   where novel_id=p_novel_id;
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    insert into public.novel_collaboration_events (
      novel_id, actor_user_id, event_type
    ) values (p_novel_id, v_uid, 'invite_revoked');
  end if;

  return v_deleted > 0;
end
$$;

create or replace function public.novelight_accept_collaboration_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token, '')));
  v_hash bytea;
  v_invite record;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if v_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='Invalid collaboration invitation';
  end if;

  v_hash := pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8'));

  select i.novel_id, n.user_id as owner_user_id, n.title, n.status
    into v_invite
    from public.novel_collaboration_invites i
    join public.novels n on n.id=i.novel_id
   where i.token_hash=v_hash
     and i.expires_at > pg_catalog.now()
   for update of i, n;

  if not found then
    raise exception using errcode='22023', message='Invitation is invalid or expired';
  end if;
  if v_invite.owner_user_id = v_uid then
    raise exception using errcode='22023', message='Owners cannot join their own novel as collaborators';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_user_id=v_invite.owner_user_id and b.blocked_user_id=v_uid)
       or (b.blocker_user_id=v_uid and b.blocked_user_id=v_invite.owner_user_id)
  ) then
    raise exception using errcode='42501',
      message='Collaboration is unavailable for this account relationship';
  end if;

  if exists (
    select 1 from public.novel_collaborators c
    where c.novel_id=v_invite.novel_id and c.collaborator_user_id=v_uid
  ) then
    delete from public.novel_collaboration_invites
     where novel_id=v_invite.novel_id and token_hash=v_hash;
    return pg_catalog.jsonb_build_object(
      'novel_id', v_invite.novel_id,
      'title', v_invite.title,
      'status', v_invite.status,
      'already_joined', true
    );
  end if;

  if (select count(*) from public.novel_collaborators c where c.novel_id=v_invite.novel_id) >= 5 then
    raise exception using errcode='22023',
      message='This novel already has the beta maximum of 5 collaborators';
  end if;

  insert into public.novel_collaborators (
    novel_id, collaborator_user_id, role
  ) values (
    v_invite.novel_id, v_uid, 'editor'
  );

  delete from public.novel_collaboration_invites
   where novel_id=v_invite.novel_id and token_hash=v_hash;

  insert into public.novel_collaboration_events (
    novel_id, actor_user_id, subject_user_id, event_type
  ) values (
    v_invite.novel_id, v_uid, v_uid, 'joined'
  );

  return pg_catalog.jsonb_build_object(
    'novel_id', v_invite.novel_id,
    'title', v_invite.title,
    'status', v_invite.status,
    'already_joined', false
  );
end
$$;

create or replace function public.novelight_remove_novel_collaborator(
  p_novel_id bigint,
  p_collaborator_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if p_collaborator_user_id is null then
    raise exception using errcode='22023', message='Collaborator is required';
  end if;
  if not exists (
    select 1 from public.novels n
    where n.id=p_novel_id and n.user_id=v_uid
  ) then
    raise exception using errcode='42501', message='Novel not found or not owned by current user';
  end if;

  delete from public.novel_collaborators
   where novel_id=p_novel_id
     and collaborator_user_id=p_collaborator_user_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception using errcode='22023', message='Collaborator not found';
  end if;

  insert into public.novel_collaboration_events (
    novel_id, actor_user_id, subject_user_id, event_type
  ) values (
    p_novel_id, v_uid, p_collaborator_user_id, 'removed'
  );

  return true;
end
$$;

create or replace function public.novelight_leave_novel_collaboration(p_novel_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  delete from public.novel_collaborators
   where novel_id=p_novel_id and collaborator_user_id=v_uid;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception using errcode='22023', message='Collaboration not found';
  end if;

  insert into public.novel_collaboration_events (
    novel_id, actor_user_id, subject_user_id, event_type
  ) values (
    p_novel_id, v_uid, v_uid, 'left'
  );

  return true;
end
$$;

create or replace function public.novelight_list_collaboration_episodes(p_novel_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if not public.novelight_collaboration_can_edit(p_novel_id, v_uid) then
    raise exception using errcode='42501', message='Collaboration edit access required';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', e.id,
      'episode_number', e.episode_number,
      'title', e.title,
      'status', e.status,
      'chapter_id', e.chapter_id,
      'created_at', e.created_at
    ) order by e.episode_number, e.id
  ), '[]'::jsonb)
    into v_result
    from public.episodes e
   where e.novel_id=p_novel_id;

  return v_result;
end
$$;

create or replace function public.novelight_get_collaboration_episode(p_episode_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_episode record;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  select e.id, e.novel_id, e.user_id, e.episode_number, e.title, e.content, e.status
    into v_episode
    from public.episodes e
   where e.id=p_episode_id;

  if not found
     or not public.novelight_collaboration_can_edit(v_episode.novel_id, v_uid) then
    raise exception using errcode='42501', message='Episode collaboration access required';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_episode.id,
    'novel_id', v_episode.novel_id,
    'owner_user_id', v_episode.user_id,
    'episode_number', v_episode.episode_number,
    'title', v_episode.title,
    'content', v_episode.content,
    'status', v_episode.status
  );
end
$$;

create or replace function public.novelight_create_collaboration_draft(
  p_novel_id bigint,
  p_title text,
  p_content text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_episode_id bigint;
  v_episode_number bigint;
  v_title text := coalesce(p_title, '');
  v_content text := coalesce(p_content, '');
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if pg_catalog.char_length(v_title) > 150 then
    raise exception using errcode='22023', message='Episode title must be at most 150 characters';
  end if;
  if pg_catalog.char_length(v_content) > 100000 then
    raise exception using errcode='22023', message='Episode content must be at most 100000 characters';
  end if;
  if not public.novelight_collaboration_can_edit(p_novel_id, v_uid) then
    raise exception using errcode='42501', message='Collaboration edit access required';
  end if;

  select n.user_id into v_owner
    from public.novels n
   where n.id=p_novel_id
   for update;

  if v_owner is null then
    raise exception using errcode='42501', message='Novel unavailable';
  end if;

  select coalesce(max(e.episode_number), 0) + 1
    into v_episode_number
    from public.episodes e
   where e.novel_id=p_novel_id;

  begin
    insert into public.episodes (
      novel_id, user_id, episode_number, title, content, status, pv
    ) values (
      p_novel_id, v_owner, v_episode_number, v_title, v_content, 'draft', 0
    )
    returning id into v_episode_id;
  exception
    when unique_violation then
      raise exception using errcode='40001',
        message='Episode order changed while creating the draft; retry';
  end;

  insert into public.novel_collaboration_events (
    novel_id, actor_user_id, episode_id, event_type
  ) values (
    p_novel_id, v_uid, v_episode_id, 'episode_created'
  );

  return v_episode_id;
end
$$;

create or replace function public.novelight_update_collaboration_episode(
  p_episode_id bigint,
  p_title text,
  p_content text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_episode record;
  v_title text := coalesce(p_title, '');
  v_content text := coalesce(p_content, '');
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if pg_catalog.char_length(v_title) > 150 then
    raise exception using errcode='22023', message='Episode title must be at most 150 characters';
  end if;
  if pg_catalog.char_length(v_content) > 100000 then
    raise exception using errcode='22023', message='Episode content must be at most 100000 characters';
  end if;

  select e.id, e.novel_id, e.status
    into v_episode
    from public.episodes e
   where e.id=p_episode_id
   for update;

  if not found
     or not public.novelight_collaboration_can_edit(v_episode.novel_id, v_uid) then
    raise exception using errcode='42501', message='Episode collaboration access required';
  end if;
  if v_episode.status='published'
     and (
       pg_catalog.char_length(pg_catalog.btrim(v_title)) < 1
       or pg_catalog.char_length(pg_catalog.btrim(v_content)) < 1
     ) then
    raise exception using errcode='22023',
      message='Published episodes require a title and content';
  end if;

  perform pg_catalog.set_config('novelight.revision_reason', 'edit', true);

  update public.episodes
     set title=v_title,
         content=v_content
   where id=p_episode_id;

  insert into public.novel_collaboration_events (
    novel_id, actor_user_id, episode_id, event_type
  ) values (
    v_episode.novel_id, v_uid, p_episode_id, 'episode_edited'
  );

  return p_episode_id;
end
$$;

revoke all on function public.novelight_collaboration_access(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_list_my_collaborations()
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_manage_novel_collaborators(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_rotate_collaboration_invite(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_revoke_collaboration_invite(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_accept_collaboration_invite(text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_remove_novel_collaborator(bigint,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_leave_novel_collaboration(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_list_collaboration_episodes(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_get_collaboration_episode(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_create_collaboration_draft(bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_update_collaboration_episode(bigint,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_collaboration_access(bigint) to authenticated;
grant execute on function public.novelight_list_my_collaborations() to authenticated;
grant execute on function public.novelight_manage_novel_collaborators(bigint) to authenticated;
grant execute on function public.novelight_rotate_collaboration_invite(bigint) to authenticated;
grant execute on function public.novelight_revoke_collaboration_invite(bigint) to authenticated;
grant execute on function public.novelight_accept_collaboration_invite(text) to authenticated;
grant execute on function public.novelight_remove_novel_collaborator(bigint,uuid) to authenticated;
grant execute on function public.novelight_leave_novel_collaboration(bigint) to authenticated;
grant execute on function public.novelight_list_collaboration_episodes(bigint) to authenticated;
grant execute on function public.novelight_get_collaboration_episode(bigint) to authenticated;
grant execute on function public.novelight_create_collaboration_draft(bigint,text,text)
  to authenticated;
grant execute on function public.novelight_update_collaboration_episode(bigint,text,text)
  to authenticated;

comment on table public.novel_collaborators is
  'B #22 accepted editor memberships. novels.user_id remains the sole owner.';
comment on table public.novel_collaboration_invites is
  'B #22 one-time invitation secrets. Only SHA-256 token hashes are stored.';
comment on table public.novel_collaboration_events is
  'B #22 private audit only; never a Rank, LIGHT SEED, SCOUT, PV, favorite, discovery, exposure, analytics, or recommendation signal.';
comment on function public.novelight_update_collaboration_episode(bigint,text,text) is
  'B #22 title/content-only editor path. It cannot publish, delete, transfer ownership, alter billing, or alter exposure.';

commit;
