-- Roll back NOVELIGHT beta exposure allocation objects.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823112000'));

revoke all on function public.record_novel_impressions(text, text[], text) from public, anon, authenticated;
revoke all on function public.novelight_discovery_feed(text, integer, text, text, text) from public, anon, authenticated;

drop function if exists public.record_novel_impressions(text, text[], text);
drop function if exists public.novelight_discovery_feed(text, integer, text, text, text);

drop table if exists public.novel_exposure_events;
drop table if exists public.novel_exposure_rules;

commit;
