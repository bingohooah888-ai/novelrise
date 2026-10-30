-- MANUAL RECOVERY ONLY. This script is destructive when used; never run automatically.
-- Requires separately approved recovery; does NOT silently rewrite the migration ledger.
-- No CASCADE: dependencies or any existing candidate rows must block rollback.
begin;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:ai-review-candidates-v1'));

do $ai_review_rollback_guard$
begin
  if pg_catalog.to_regclass('public.novelight_ai_review_candidates') is null then
    raise exception 'AI review rollback blocked: expected table missing';
  end if;
  if exists (select 1 from public.novelight_ai_review_candidates) then
    raise exception 'AI review rollback blocked: preserving candidate decisions';
  end if;
  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (
      select 1 from public.novelight_ai_runtime_settings where singleton = 1
        and enabled = false and user_day_cap_micros = 0
        and user_month_cap_micros = 0 and global_day_cap_micros = 0
        and global_month_cap_micros = 0
    ) then
    raise exception 'AI review rollback blocked: AI runtime or budget changed';
  end if;
end;
$ai_review_rollback_guard$;

drop function public.novelight_ai_review_stage_batch(uuid,bigint,bigint,text,text,jsonb);
drop function public.novelight_ai_review_decide(uuid,bigint,bigint,text,integer,text);
drop table public.novelight_ai_review_candidates;

commit;
