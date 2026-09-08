-- Roll back only the aggregate LIGHT ANALYTICS visual-trend endpoint.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260908172000:rollback'));

revoke all on function public.novelight_author_analytics_timeseries(integer)
  from public, anon, authenticated;

drop function public.novelight_author_analytics_timeseries(integer);

commit;