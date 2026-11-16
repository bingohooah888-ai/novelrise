-- NOVELIGHT AI Phase 02-07-05 OWNER checklist review-state storage.
-- REVIEW-ONLY PROPOSAL. NOT A MIGRATION. DO NOT EXECUTE.
-- Staging installation requires a separately scoped OWNER approval.
-- Unrelated remote-only migrations remain isolated and untouched.
-- No public route imports the adapter; no live JWT/DB/SQL proof exists.
-- Distinct from candidate accepted/rejected and author-confirmed canon.
begin;

do $review_state_guard$
begin
  if pg_catalog.to_regclass('public.novelight_ai_owner_review_states') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_owner_review_state_cas(uuid,bigint,uuid,integer,jsonb)') is not null
  then
    raise exception 'AI checklist review-state schema already exists';
  end if;
end
$review_state_guard$;

-- Refuse to create an unusable RPC while target role privileges remain
-- unproven; this guard is evaluated at installation, not trusted from a PR.
-- This proposal must remain UNAPPLIED until separately scoped approval.
-- The installing role must own the limited auth row-lock privilege.
-- The backend service_role must NEVER get UPDATE/SELECT on auth.sessions.
do $review_state_privilege_guard$
declare
  v_sessions regclass := pg_catalog.to_regclass('auth.sessions');
  v_novels regclass := pg_catalog.to_regclass('public.novels');
begin
  if v_sessions is null or v_novels is null
    or pg_catalog.to_regnamespace('novelight_ai_private') is not null
    or not exists (select 1 from pg_catalog.pg_attribute
      where attrelid = v_sessions and attname='not_after' and not attisdropped)
    or not pg_catalog.has_schema_privilege(current_user,'auth','USAGE')
    or not pg_catalog.has_column_privilege(current_user,v_sessions,'id','SELECT')
    or not pg_catalog.has_column_privilege(current_user,v_sessions,'user_id','SELECT')
    or not pg_catalog.has_column_privilege(current_user,v_sessions,'not_after','SELECT')
    or not pg_catalog.has_any_column_privilege(current_user,v_sessions,'UPDATE')
    or not pg_catalog.has_column_privilege('service_role',v_novels,'id','SELECT')
    or not pg_catalog.has_column_privilege('service_role',v_novels,'user_id','SELECT')
    or not pg_catalog.has_any_column_privilege('service_role',v_novels,'UPDATE')
  then
    raise exception using errcode='42501',
      message='OWNER review CAS prerequisite privileges are not proven';
  end if;
end
$review_state_privilege_guard$;

-- Strictly limited non-exposed helper; the only SECURITY DEFINER in this
-- proposal. It returns only one boolean. CAS holds a SHARE row lock through
-- the caller's transaction; read-only checks acquire no lock.
-- Installation must verify this schema is NOT exposed by the Data API.
create schema novelight_ai_private;
revoke all on schema novelight_ai_private from public, anon, authenticated;
grant usage on schema novelight_ai_private to service_role;

create function novelight_ai_private.session_active_v1(
  p_session_id uuid, p_actor_id uuid, p_take_lock boolean
) returns boolean
language plpgsql security definer set search_path = '' as $
begin
  if p_session_id is null or p_actor_id is null or p_take_lock is null then
    return false;
  end if;
  if p_take_lock then
    perform 1 from auth.sessions s
      where s.id = p_session_id and s.user_id = p_actor_id
        and (s.not_after is null or s.not_after > pg_catalog.clock_timestamp())
      for share of s;
  else
    perform 1 from auth.sessions s
      where s.id = p_session_id and s.user_id = p_actor_id
        and (s.not_after is null or s.not_after > pg_catalog.clock_timestamp());
  end if;
  return found;
end
$;
revoke all on function novelight_ai_private.session_active_v1(
  uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function novelight_ai_private.session_active_v1(
  uuid, uuid, boolean
) to service_role;

-- A public SECURITY INVOKER wrapper is callable only by the backend
-- service_role, and only AFTER its signed JWT and owner checks.
create function public.novelight_ai_owner_session_exists_v1(
  p_session_id uuid, p_actor_id uuid
) returns boolean
language plpgsql security invoker set search_path = '' as $
begin
  if current_user <> 'service_role' then
    raise exception using errcode='42501',message='AI service access required';
  end if;
  return novelight_ai_private.session_active_v1(
    p_session_id,p_actor_id,false
  );
end
$;
revoke all on function public.novelight_ai_owner_session_exists_v1(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.novelight_ai_owner_session_exists_v1(
  uuid, uuid
) to service_role;

create table public.novelight_ai_owner_review_states (
  actor_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  version integer not null default 1 check (version = 1),
  revision integer not null check (revision >= 1),
  reviewed_ids jsonb not null default '[]'::jsonb
    check (
      pg_catalog.jsonb_typeof(reviewed_ids) = 'array'
      and pg_catalog.jsonb_array_length(reviewed_ids) <= 100
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, novel_id)
);

-- Parent deletion requires a leading novel-id index; the composite PK
-- begins with actor_id and cannot efficiently service this FK check.
create index novelight_ai_owner_review_novel_fk_idx
  on public.novelight_ai_owner_review_states (novel_id);

-- Backend-only SECURITY INVOKER CAS; signed session_id is never
-- accepted from unverified JWT, browser request fields, or a user claim.
-- A private boolean helper holds the exact Auth row during this transaction.
create function public.novelight_ai_owner_review_state_cas(
  p_actor_id uuid,
  p_novel_id bigint,
  p_session_id uuid,
  p_expected_revision integer,
  p_reviewed_ids jsonb
) returns table(
  actor_id uuid,
  novel_id bigint,
  version integer,
  revision integer,
  reviewed_ids jsonb
)
language plpgsql security invoker set search_path = '' as $$
declare
  v_json_id jsonb;
  v_text_id text;
  v_seen text[] := array[]::text[];
  v_old_revision integer;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'AI service access required';
  end if;

  if p_actor_id is null or p_novel_id is null or p_novel_id <= 0
    or p_session_id is null
    or p_expected_revision is null or p_expected_revision < 0
    or p_expected_revision = 2147483647
    or pg_catalog.jsonb_typeof(p_reviewed_ids) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_reviewed_ids) > 100
  then
    raise exception using errcode = '22023', message = 'Invalid checklist review state';
  end if;

  for v_json_id in select value from pg_catalog.jsonb_array_elements(p_reviewed_ids)
  loop
    if pg_catalog.jsonb_typeof(v_json_id) is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Invalid checklist ID';
    end if;
    v_text_id := v_json_id #>> '{}';
    if v_text_id !~ '^rv1-[0-9a-f]{16}$'
      or v_text_id = any(v_seen)
    then
      raise exception using errcode = '22023', message = 'Invalid checklist ID';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_text_id);
  end loop;

  -- A SELECT ... FOR SHARE lock prevents owner transfer/deletion until this
  -- transaction commits. Client-declared owner IDs never grant ownership.
  perform 1
  from public.novels n
  where n.id = p_novel_id and n.user_id = p_actor_id
  for share of n;
  if not found then
    raise exception using errcode = '42501', message = 'Review scope denied';
  end if;

  -- A competing revocation either wins first and rejects this save, or
  -- waits for the SHARE lock until our CAS transaction commits.
  -- auth.sessions.not_after prevents already expired sessions being saved.
  if not novelight_ai_private.session_active_v1(
    p_session_id,p_actor_id,true
  ) then
    raise exception using errcode='42501',message='Review session revoked';
  end if;

  -- Same work + actor writes serialize, including first-write races.
  -- SQL UPDATE/INSERT still enforce exact expected revision (true CAS).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_actor_id::text),
    pg_catalog.hashtext(p_novel_id::text)
  );

  select s.revision into v_old_revision
  from public.novelight_ai_owner_review_states s
  where s.actor_id = p_actor_id
    and s.novel_id = p_novel_id
  for update of s;

  if not found then
    if p_expected_revision <> 0 then
      return; -- a conflict, not an upsert or a guessed revision
    end if;
    return query
      insert into public.novelight_ai_owner_review_states as s (
        actor_id, novel_id, version, revision, reviewed_ids
      ) values (p_actor_id, p_novel_id, 1, 1, p_reviewed_ids)
      on conflict (actor_id, novel_id) do nothing
      returning s.actor_id, s.novel_id, s.version, s.revision, s.reviewed_ids;
    return;
  end if;

  if v_old_revision <> p_expected_revision then
    return; -- a concurrent or stale writer cannot silently overwrite
  end if;

  return query
    update public.novelight_ai_owner_review_states as s
      set revision = s.revision + 1,
          reviewed_ids = p_reviewed_ids,
          updated_at = now()
    where s.actor_id = p_actor_id
      and s.novel_id = p_novel_id
      and s.revision = p_expected_revision
      and exists (
        select 1 from public.novels n
        where n.id = s.novel_id and n.user_id = p_actor_id
      )
    returning s.actor_id, s.novel_id, s.version, s.revision, s.reviewed_ids;
end
$$;

alter table public.novelight_ai_owner_review_states enable row level security;

create policy ai_owner_review_service_only
  on public.novelight_ai_owner_review_states
  for all to service_role using (true) with check (true);

revoke all on public.novelight_ai_owner_review_states
  from public, anon, authenticated;
grant select, insert, update on public.novelight_ai_owner_review_states
  to service_role;

revoke all on function public.novelight_ai_owner_review_state_cas(
  uuid, bigint, uuid, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.novelight_ai_owner_review_state_cas(
  uuid, bigint, uuid, integer, jsonb
) to service_role;

comment on table public.novelight_ai_owner_review_states is
  'Owner-only checklist acknowledgements; does not accept AI candidates or alter canon.';

commit;
