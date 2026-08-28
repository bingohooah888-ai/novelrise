begin;
revoke all on function public.novelight_author_basic_metrics() from public, anon, authenticated;
drop function if exists public.novelight_author_basic_metrics();
commit;
