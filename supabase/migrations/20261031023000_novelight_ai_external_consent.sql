-- NOVELIGHT AI 02-07-04: external processing consent persistence (candidate only).
-- Source: reviewed rollback-only proposal; no author consent or AI activation is implied.
-- Staging requires separate exact-head OWNER approval. NEVER auto-apply to Production.
begin;

do $ai_consent_migration_guard$
begin
  if pg_catalog.to_regclass('public.novelight_ai_external_processing_consents') is not null
    or pg_catalog.to_regclass('public.novelight_ai_external_consent_action_audit') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_consent_grant(uuid,bigint,text,text)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_consent_revoke(uuid,bigint,text)') is not null then
    raise exception 'AI consent migration blocked: candidate objects already exist';
  end if;
  if pg_catalog.to_regclass('public.novelight_ai_review_candidates') is null
    or pg_catalog.to_regclass('public.novelight_ai_runtime_settings') is null then
    raise exception 'AI consent migration blocked: prerequisite schema missing';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (select 1 from public.novelight_ai_runtime_settings
      where singleton=1 and enabled=false
        and user_day_cap_micros=0 and user_month_cap_micros=0
        and global_day_cap_micros=0 and global_month_cap_micros=0) then
    raise exception 'AI consent migration blocked: AI already activated';
  end if;
end;
$ai_consent_migration_guard$;

create table public.novelight_ai_external_processing_consents (
  actor_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  purpose text not null check (purpose = 'external-novel-bible-analysis'),
  processor text not null check (processor in ('openai', 'gemini')),
  policy_revision text not null
    check (policy_revision ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{3,119}$'),
  granted_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novelight_ai_consent_valid_period
    check (
      expires_at > granted_at
      and expires_at <= granted_at + interval '90 days'
      and (revoked_at is null or revoked_at >= granted_at)
    ),
  primary key (actor_id, novel_id, purpose, processor)
);

-- The composite primary key supports per-actor, per-work, per-processor
-- reads; the FK also requires a leading novel index for delete checks.
create index novelight_ai_external_consent_novel_idx
  on public.novelight_ai_external_processing_consents (novel_id);

alter table public.novelight_ai_external_processing_consents
  enable row level security;

-- No browser role can read or fabricate consent, including anon users.
-- A separately reviewed AUTHOR-JWT consent grant/revoke operation will be
-- required before the feature may run. Do not insert via admin bypass as a
-- substitute for an authenticated author's explicit consent.
create policy ai_external_consent_service_only
  on public.novelight_ai_external_processing_consents
  for all to service_role using (true) with check (true);

revoke all on table public.novelight_ai_external_processing_consents
  from public, anon, authenticated;
grant select, insert, update on table
  public.novelight_ai_external_processing_consents to service_role;

-- No authenticated browser policy exists. Only service_role is admitted.
-- The backend must independently verify the real author JWT and work scope.

-- REVIEW ONLY: server-side action audit; not visible to browsers.
create table public.novelight_ai_external_consent_action_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  processor text not null check (processor in ('openai', 'gemini')),
  action text not null check (action in ('granted', 'revoked')),
  policy_revision text not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index novelight_ai_external_consent_audit_novel_idx
  on public.novelight_ai_external_consent_action_audit (novel_id);
alter table public.novelight_ai_external_consent_action_audit
  enable row level security;
create policy ai_external_consent_audit_service_only
  on public.novelight_ai_external_consent_action_audit
  for all to service_role using (true) with check (true);

revoke all on table public.novelight_ai_external_consent_action_audit
  from public, anon, authenticated;
grant select, insert on table
  public.novelight_ai_external_consent_action_audit to service_role;
-- Lock down the generated audit identity sequence, independently of table RLS.
revoke all on sequence public.novelight_ai_external_consent_action_audit_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.novelight_ai_external_consent_action_audit_id_seq
  to service_role;

-- Authenticated browser roles cannot call these RPCs or mutate the table.
-- The future server-only caller MUST independently verify an author bearer,
-- explicit author action and novel ownership; the RPC also checks ownership.
create or replace function public.novelight_ai_consent_grant(
  p_actor_id uuid,
  p_novel_id bigint,
  p_processor text,
  p_policy_revision text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz;
  v_expires timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'AI consent service access required';
  end if;
  if p_actor_id is null or p_novel_id is null or p_novel_id < 1
    or p_processor is null or p_processor not in ('openai', 'gemini')
    or p_policy_revision is null
    or p_policy_revision !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{3,119}$'

  then
    raise exception using errcode = '22023',
      message = 'Invalid AI consent request';
  end if;
  perform 1 from public.novels n
   where n.id = p_novel_id and n.user_id = p_actor_id
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'Consent owner denied';
  end if;
  -- Serialize grant/revoke per novel and processor BEFORE setting timestamps.
  -- A queued revoke must not inherit a pre-lock time older than a new grant.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('novelight-ai-consent-v1:' || p_novel_id::text || ':' || p_processor)
  );
  v_now := clock_timestamp();
  v_expires := v_now + interval '30 days';
  insert into public.novelight_ai_external_processing_consents (
    actor_id, novel_id, purpose, processor, policy_revision,
    granted_at, expires_at, revoked_at, updated_at
  ) values (
    p_actor_id, p_novel_id, 'external-novel-bible-analysis',
    p_processor, p_policy_revision, v_now, v_expires, null, v_now
  ) on conflict (actor_id, novel_id, purpose, processor)
  do update set
    policy_revision = excluded.policy_revision,
    granted_at = excluded.granted_at,
    expires_at = excluded.expires_at,
    revoked_at = null,
    updated_at = excluded.updated_at;

  insert into public.novelight_ai_external_consent_action_audit (
    actor_id, novel_id, processor, action, policy_revision, occurred_at
  ) values (
    p_actor_id, p_novel_id, p_processor, 'granted', p_policy_revision, v_now
  );
  return pg_catalog.jsonb_build_object(
    'status', 'granted', 'processor', p_processor,
    'policyRevision', p_policy_revision, 'expiresAt', v_expires
  );
end;
$$;
revoke all on function public.novelight_ai_consent_grant(
  uuid, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.novelight_ai_consent_grant(
  uuid, bigint, text, text
) to service_role;

create or replace function public.novelight_ai_consent_revoke(
  p_actor_id uuid,
  p_novel_id bigint,
  p_processor text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz;
  v_effective timestamptz;
  v_previous timestamptz;
  v_policy_revision text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'AI consent service access required';
  end if;
  if p_actor_id is null or p_novel_id is null or p_novel_id < 1
    or p_processor is null or p_processor not in ('openai', 'gemini')
  then
    raise exception using errcode = '22023',
      message = 'Invalid AI consent revoke';
  end if;
  perform 1 from public.novels n
   where n.id = p_novel_id and n.user_id = p_actor_id
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'Consent owner denied';
  end if;
  -- Same per-work, per-processor lock as grant. Capture time only after
  -- admission to the serialized critical section.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('novelight-ai-consent-v1:' || p_novel_id::text || ':' || p_processor)
  );
  v_now := clock_timestamp();
  select c.revoked_at, c.policy_revision
    into v_previous, v_policy_revision
    from public.novelight_ai_external_processing_consents c
    where c.actor_id = p_actor_id
      and c.novel_id = p_novel_id
      and c.purpose = 'external-novel-bible-analysis'
      and c.processor = p_processor
    for update;
  if not found then
    raise exception using errcode = '22023', message = 'Consent not found';
  end if;
  v_effective := coalesce(v_previous, v_now);
  if v_previous is null then
    update public.novelight_ai_external_processing_consents
      set revoked_at = v_effective, updated_at = v_now
      where actor_id = p_actor_id and novel_id = p_novel_id
        and purpose = 'external-novel-bible-analysis'
        and processor = p_processor;
    insert into public.novelight_ai_external_consent_action_audit (
      actor_id, novel_id, processor, action, policy_revision, occurred_at
    ) values (
      p_actor_id, p_novel_id, p_processor, 'revoked',
      v_policy_revision, v_effective
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'revoked', 'processor', p_processor,
    'revokedAt', v_effective
  );
end;
$$;
revoke all on function public.novelight_ai_consent_revoke(
  uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.novelight_ai_consent_revoke(
  uuid, bigint, text
) to service_role;

commit;
