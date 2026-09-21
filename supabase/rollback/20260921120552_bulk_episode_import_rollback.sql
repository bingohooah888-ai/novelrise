-- Rollback for 20260921120552_bulk_episode_import.sql
--
-- Fail closed after real analytics data exists. Preserve/export that data before
-- attempting a production rollback after users have started importing works.

begin;

do $$
begin
  if to_regclass('public.bulk_import_events') is not null
     and exists (select 1 from public.bulk_import_events limit 1) then
    raise exception 'bulk_import_events contains data; preserve it before rollback';
  end if;
end
$$;

drop function if exists public.novelight_record_bulk_import_event(text,bigint,integer);
drop function if exists public.novelight_bulk_import_episode_drafts(bigint,jsonb);
drop table if exists public.bulk_import_events;

do $$
begin
  if to_regprocedure('public.novelight_import_episode_drafts(bigint,jsonb)') is null then
    raise exception 'Existing beta import RPC was unexpectedly removed';
  end if;
end
$$;

commit;
