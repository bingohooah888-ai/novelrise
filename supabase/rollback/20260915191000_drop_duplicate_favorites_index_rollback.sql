-- NOVELIGHT duplicate favorites index rollback.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915191000-favorites-duplicate-index'));

create unique index if not exists favorites_user_novel_unique
  on public.favorites (user_id, novel_id);

commit;

select 'PASS: duplicate favorites index rollback' as result;
