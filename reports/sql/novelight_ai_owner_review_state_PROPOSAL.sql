-- NOVELIGHT AI Phase 02-07-05 OWNER checklist review-state storage.
-- REVIEW-ONLY PROPOSAL. NOT A MIGRATION. DO NOT EXECUTE.
-- Existing Supabase Preview migration divergence must be reconciled in a
-- separately authorized Staging plan BEFORE generating an actual migration.
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

-- Caller is the backend's service-role-only RPC, never the browser.
-- SECURITY INVOKER and explicit service-only EXECUTE grants avoid a
-- publicly callable definer. The SQL itself verifies the current owner,
-- signed session_id/actor tuple, and old revision within one transaction.
-- IMPORTANT: read access to auth.sessions for service_role must be proven
-- in an authorized Staging environment. Missing privilege MUST fail closed;
-- do not add a public auth.sessions query or privileged SECURITY DEFINER.
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

  -- Independently verify the *signed* session_id against the server-owned
  -- auth.sessions row; FOR SHARE protects against row deletion during CAS.
  -- p_session_id MUST come only from verified signed session claims, NEVER
  -- from the browser body or unverified JWT decoding.
  perform 1
  from auth.sessions s
  where s.id = p_session_id and s.user_id = p_actor_id
  for share of s;
  if not found then
    raise exception using errcode = '42501', message = 'Review session revoked';
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
