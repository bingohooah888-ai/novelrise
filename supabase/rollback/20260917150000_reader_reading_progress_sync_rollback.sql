-- Rollback for 20260917150000_reader_reading_progress_sync.sql
-- This intentionally deletes synchronized reader progress rows if executed.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917150000'));

drop trigger if exists reader_reading_progress_guard on public.reader_reading_progress;
drop function if exists public.novelight_guard_reader_reading_progress();
drop table if exists public.reader_reading_progress;

commit;
