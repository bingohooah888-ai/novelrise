-- MANUAL RECOVERY ONLY; separate exact-SHA authorization required.
-- NO CASCADE, no ledger repair. Any consent or audit records block rollback.
begin;

do $ai_consent_rollback_guard$
begin
  if pg_catalog.to_regclass('public.novelight_ai_external_processing_consents') is null
    or pg_catalog.to_regclass('public.novelight_ai_external_consent_action_audit') is null then
    raise exception 'AI consent rollback blocked: expected tables missing';
  end if;
  if exists (select 1 from public.novelight_ai_external_processing_consents)
    or exists (select 1 from public.novelight_ai_external_consent_action_audit) then
    raise exception 'AI consent rollback blocked: preserve all consent audit evidence';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (select 1 from public.novelight_ai_runtime_settings
      where singleton=1 and enabled=false
        and user_day_cap_micros=0 and user_month_cap_micros=0
        and global_day_cap_micros=0 and global_month_cap_micros=0) then
    raise exception 'AI consent rollback blocked: runtime or budgets changed';
  end if;
end;
$ai_consent_rollback_guard$;

drop function public.novelight_ai_consent_grant(uuid,bigint,text,text);
drop function public.novelight_ai_consent_revoke(uuid,bigint,text);
drop table public.novelight_ai_external_consent_action_audit;
drop table public.novelight_ai_external_processing_consents;

commit;
