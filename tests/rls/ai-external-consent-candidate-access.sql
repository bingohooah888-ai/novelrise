-- Run ONLY against disposable PostgreSQL migration replay.
-- Verify that neither browser role can access or invoke the AI consent gate.
begin;
set local role anon;
do $ai_consent_anon$
declare
  v_result jsonb;
begin
  if pg_catalog.has_table_privilege('anon',
      'public.novelight_ai_external_processing_consents','SELECT')
    or pg_catalog.has_table_privilege('anon',
      'public.novelight_ai_external_consent_action_audit','INSERT')
    or pg_catalog.has_sequence_privilege('anon',
      'public.novelight_ai_external_consent_action_audit_id_seq','USAGE') then
    raise exception 'ANON_CONSENT_TABLE_OR_SEQUENCE_EXPOSED';
  end if;
  begin
    select public.novelight_ai_consent_grant(
      '00000000-0000-4000-8000-000000000001'::uuid,
      1,'openai','policy.v1') into v_result;
    raise exception 'ANON_CONSENT_RPC_UNEXPECTEDLY_EXECUTED';
  exception when insufficient_privilege then
    null;
  end;
end;
$ai_consent_anon$;
rollback;

begin;
set local role authenticated;
do $ai_consent_auth$
declare
  v_result jsonb;
begin
  if pg_catalog.has_table_privilege('authenticated',
      'public.novelight_ai_external_processing_consents','SELECT')
    or pg_catalog.has_table_privilege('authenticated',
      'public.novelight_ai_external_consent_action_audit','INSERT')
    or pg_catalog.has_sequence_privilege('authenticated',
      'public.novelight_ai_external_consent_action_audit_id_seq','USAGE') then
    raise exception 'AUTHENTICATED_CONSENT_TABLE_OR_SEQUENCE_EXPOSED';
  end if;
  begin
    select public.novelight_ai_consent_revoke(
      '00000000-0000-4000-8000-000000000001'::uuid,
      1,'openai') into v_result;
    raise exception 'AUTHENTICATED_CONSENT_RPC_UNEXPECTEDLY_EXECUTED';
  exception when insufficient_privilege then
    null;
  end;
end;
$ai_consent_auth$;
rollback;
