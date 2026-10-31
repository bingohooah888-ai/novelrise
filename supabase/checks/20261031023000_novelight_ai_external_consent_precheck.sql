-- Read-only, fail-closed staging prerequisites for external AI consent.
-- This is not authorization to apply a migration.
do $ai_consent_precheck$
begin
  if pg_catalog.to_regclass('public.novels') is null
    or pg_catalog.to_regclass('public.novelight_ai_review_candidates') is null
    or pg_catalog.to_regclass('public.novelight_ai_runtime_settings') is null
    or not exists (select 1 from pg_catalog.pg_class
      where oid='public.novelight_ai_review_candidates'::regclass
        and relrowsecurity) then
    raise exception 'AI consent precheck: prerequisite tables or RLS missing';
  end if;
  if pg_catalog.to_regclass('public.novelight_ai_external_processing_consents') is not null
    or pg_catalog.to_regclass('public.novelight_ai_external_consent_action_audit') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_consent_grant(uuid,bigint,text,text)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_consent_revoke(uuid,bigint,text)') is not null then
    raise exception 'AI consent precheck: target objects already exist';
  end if;
  if (select count(*) from public.novelight_ai_review_candidates) <> 0 then
    raise exception 'AI consent precheck: review candidates must be empty';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (select 1 from public.novelight_ai_runtime_settings
      where singleton=1 and enabled=false
        and user_day_cap_micros=0 and user_month_cap_micros=0
        and global_day_cap_micros=0 and global_month_cap_micros=0) then
    raise exception 'AI consent precheck: AI switch or budgets changed';
  end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='service_role') then
    raise exception 'AI consent precheck: service_role missing';
  end if;
end;
$ai_consent_precheck$;
