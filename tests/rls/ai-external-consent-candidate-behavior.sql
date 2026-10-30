-- Disposable Postgres only: synthetic author and novel; ROLLBACK always.
-- Never execute against a hosted project, since this fixture creates records.
begin;

insert into auth.users (id,email) values (
  '77777777-7777-4777-8777-777777777777',
  'novelight-ai-consent-disposable@example.invalid'
) on conflict (id) do nothing;

insert into public.novels (id,user_id) values (
  876123456789001,
  '77777777-7777-4777-8777-777777777777'
);

-- Disposable CI service_role differs from real Supabase: it has no BYPASSRLS.
-- Match the verified isolated Staging role inside this ROLLBACK-only transaction.
-- No role alteration or synthetic author survives this SQL fixture.
grant select on public.novels to service_role;
alter role service_role bypassrls;
do $ai_consent_fixture_owner$
begin
  if not exists (select 1 from public.novels
    where id=876123456789001
      and user_id='77777777-7777-4777-8777-777777777777'::uuid) then
    raise exception 'SYNTHETIC_CONSENT_OWNER_NOT_PRESENT';
  end if;
end;
$ai_consent_fixture_owner$;

set local role service_role;

do $ai_consent_behavior$
declare
  v_actor uuid := '77777777-7777-4777-8777-777777777777';
  v_novel bigint := 876123456789001;
  v_grant jsonb;
  v_revoke jsonb;
  v_row public.novelight_ai_external_processing_consents%rowtype;
begin
  v_grant := public.novelight_ai_consent_grant(
    v_actor,v_novel,'openai','policy.v1');
  if v_grant->>'status' <> 'granted'
    or v_grant->>'processor' <> 'openai' then
    raise exception 'AI_CONSENT_GRANT_FAILED';
  end if;
  select * into v_row
    from public.novelight_ai_external_processing_consents c
    where c.actor_id=v_actor and c.novel_id=v_novel and c.processor='openai';
  if not found or v_row.revoked_at is not null
    or v_row.expires_at <> (v_grant->>'expiresAt')::timestamptz then
    raise exception 'AI_CONSENT_GRANT_NOT_STORED';
  end if;
  if exists (select 1 from public.novelight_ai_external_processing_consents
      where actor_id=v_actor and novel_id=v_novel and processor='gemini') then
    raise exception 'AI_CONSENT_PROVIDER_ISOLATION_FAILED';
  end if;
  v_revoke := public.novelight_ai_consent_revoke(v_actor,v_novel,'openai');
  if v_revoke->>'status' <> 'revoked' then
    raise exception 'AI_CONSENT_REVOKE_FAILED';
  end if;
  select * into v_row from public.novelight_ai_external_processing_consents
    where actor_id=v_actor and novel_id=v_novel and processor='openai';
  if v_row.revoked_at is null or v_row.revoked_at < v_row.granted_at then
    raise exception 'AI_CONSENT_REVOKE_NOT_STORED';
  end if;
  v_grant := public.novelight_ai_consent_grant(
    v_actor,v_novel,'openai','policy.v2');
  select * into v_row from public.novelight_ai_external_processing_consents
    where actor_id=v_actor and novel_id=v_novel and processor='openai';
  if v_row.revoked_at is not null or v_row.policy_revision <> 'policy.v2'
    or (select count(*) from public.novelight_ai_external_consent_action_audit
        where actor_id=v_actor and novel_id=v_novel and processor='openai') <> 3 then
    raise exception 'AI_CONSENT_REGRANT_AUDIT_FAILED';
  end if;
end;
$ai_consent_behavior$;

reset role;
rollback;
