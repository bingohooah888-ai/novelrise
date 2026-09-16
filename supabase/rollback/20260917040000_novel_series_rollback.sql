\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917040000-novel-series'));

drop function if exists public.novelight_public_series_context(bigint);
drop function if exists public.novelight_set_series_items(bigint, bigint[]);
drop table if exists public.novel_series_items;
drop table if exists public.novel_series;

commit;
