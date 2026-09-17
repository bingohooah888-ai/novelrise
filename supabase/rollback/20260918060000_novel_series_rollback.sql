\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918060000-novel-series'));

do $$
begin
  if exists (select 1 from public.novel_series_items limit 1)
     or exists (select 1 from public.novel_series limit 1) then
    raise exception 'Refusing novel series rollback while series data exists';
  end if;
end
$$;

drop function if exists public.novelight_public_series_context(bigint);
drop function if exists public.novelight_set_series_items(bigint, bigint[]);
drop table if exists public.novel_series_items;
drop table if exists public.novel_series;

commit;
