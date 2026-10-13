\set ON_ERROR_STOP on

-- Revert the new callable capability only. Notes that users already deleted
-- are permanently gone and must never be silently reconstructed.
begin;
drop function if exists public.novelight_delete_my_author_note(bigint);
commit;
