-- Roll back NOVELIGHT exposure-to-reading funnel objects.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823115300'));

revoke all on function public.novelight_author_exposure_funnel(integer) from public, anon, authenticated;
revoke all on function public.record_novel_exposure_conversion(text, text, text, text) from public, anon, authenticated;

drop function if exists public.novelight_author_exposure_funnel(integer);
drop function if exists public.record_novel_exposure_conversion(text, text, text, text);

drop table if exists public.novel_exposure_conversions;

commit;
