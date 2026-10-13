-- Controlled rollback of stage 06 part B (server-only session proof).
-- Only run under approved rollback workflow. Do not undo read events,
-- contests, user data, eligibility, points or stage 06 part A.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013152000:session-proof')
);
drop function if exists
  public.novelight_contest_heartbeat_read_session(
    uuid,uuid,integer,numeric,boolean,boolean
  );
drop function if exists
  public.novelight_contest_begin_read_session(uuid,bigint,text);
alter table public.novelight_contest_read_sessions
  drop column if exists reading_mode;
commit;
