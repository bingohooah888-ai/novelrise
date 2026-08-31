begin;
select pg_advisory_xact_lock(hashtext('novelrise:20260831210000'));
drop function if exists public.record_trusted_allocation_receipts(uuid[]);
drop function if exists public.novelight_trusted_plan_extra_feed(integer, text[], text);
drop function if exists public.novelight_trusted_discovery_feed(text, integer, text, text, text);
drop table if exists public.neutral_search_impression_telemetry;
drop table if exists public.novel_allocation_receipts;
grant execute on function public.record_novel_impressions(text, text[], text) to anon, authenticated;
grant execute on function public.record_novel_impressions_v2(text, text[], text) to anon, authenticated;
drop function public.record_neutral_search_impressions(text[], text);
-- Restore the historical implementation by rerunning 20260823171500 after rollback.
commit;
