-- Rollback for 20260917112000_author_backup_exports.sql
-- This removes the author-backup audit history and rate-limit function.
-- Run only through the normal destructive/Production approval boundary.

begin;

drop function if exists public.novelight_begin_author_backup_export(uuid);
drop table if exists public.author_backup_exports;

commit;
