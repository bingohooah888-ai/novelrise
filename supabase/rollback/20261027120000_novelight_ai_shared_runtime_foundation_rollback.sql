-- Emergency manual rollback ONLY, never run automatically.
-- Destructive rollback is prohibited if the AI kill switch is on,
-- any AI activity exists, or any application data have been stored.
-- No CASCADE: if a newer object depends on these, fail closed.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:ai-runtime-v1')
);

do $ai_rollback_guard$
declare
  v_name text;
  v_count bigint;
begin
  foreach v_name in array array[
    'novelight_ai_runtime_settings',
    'novelight_ai_usage_requests',
    'novelight_ai_usage_audit',
    'novelight_ai_bible_facts',
    'novelight_ai_episode_analysis'
  ] loop
    if pg_catalog.to_regclass('public.' || v_name) is null then
      raise exception 'AI rollback blocked: expected table % missing', v_name;
    end if;
  end loop;

  if exists (
    select 1 from public.novelight_ai_runtime_settings
    where enabled <> false
      or user_day_cap_micros <> 0
      or user_month_cap_micros <> 0
      or global_day_cap_micros <> 0
      or global_month_cap_micros <> 0
  ) or (select count(*) from public.novelight_ai_runtime_settings) <> 1 then
    raise exception 'AI rollback blocked: runtime has been enabled or budget changed';
  end if;

  if exists (select 1 from public.novelight_ai_usage_requests)
    or exists (select 1 from public.novelight_ai_usage_audit)
    or exists (select 1 from public.novelight_ai_bible_facts)
    or exists (select 1 from public.novelight_ai_episode_analysis) then
    raise exception 'AI rollback blocked: runtime data exists; preserving all data';
  end if;
end;
$ai_rollback_guard$;

drop table public.novelight_ai_episode_analysis;
drop table public.novelight_ai_bible_facts;
drop table public.novelight_ai_usage_audit;
drop table public.novelight_ai_usage_requests;
drop table public.novelight_ai_runtime_settings;

drop function public.novelight_ai_fact_source_guard();
drop function public.novelight_ai_reserve_usage(uuid, text, bigint, bigint, text);
drop function public.novelight_ai_settle_usage(uuid, bigint);

commit;
