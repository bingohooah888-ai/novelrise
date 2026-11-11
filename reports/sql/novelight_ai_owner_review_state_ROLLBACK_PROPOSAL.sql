-- PROPOSED ISOLATED STAGING ROLLBACK ONLY. DESTRUCTIVE IF EXECUTED.
-- DO NOT EXECUTE; NOT A MIGRATION; NOT APPROVED for Production or Staging.
-- Strictly requires: exact SHA/environment, separate rollback approval,
-- proof no genuine author data exists, and independent migration-history plan.
-- First rollback action is to keep AI preview/review flags OFF. This script
-- exists for an exclusively synthetic, isolated, EMPTY Staging table.
-- No CASCADE, no dropping auth/session/novel data, no automatic history repair.
begin;

do $review_state_rollback_guard$
begin
  if pg_catalog.to_regclass('public.novelight_ai_owner_review_states') is null
    or pg_catalog.to_regprocedure(
      'public.novelight_ai_owner_review_state_cas(uuid,bigint,uuid,integer,jsonb)'
    ) is null
  then
    raise exception 'OWNER review rollback blocked: missing exact objects';
  end if;
  if exists (select 1 from public.novelight_ai_owner_review_states limit 1) then
    raise exception 'OWNER review rollback blocked: table is not empty';
  end if;
end
$review_state_rollback_guard$;

drop function public.novelight_ai_owner_review_state_cas(
  uuid, bigint, uuid, integer, jsonb
) restrict;
drop table public.novelight_ai_owner_review_states restrict;

commit;

-- Before any future use, verify no additional callers or dependencies and
-- obtain explicit approval of the destructive operation. This script does
-- not modify Supabase migration history; version reconciliation is separate.
