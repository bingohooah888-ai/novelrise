-- Restore draft creation timestamps that were moved on first publish and remove
-- the first-publication guard. Run only after reviewing exposure/billing impact.

begin;
select pg_advisory_xact_lock(hashtext('novelrise:20260823172000'));

drop trigger if exists novels_lock_first_publication_time on public.novels;
drop function if exists public.lock_first_publication_time();

update public.novels n
set created_at = b.original_created_at
from novelrise_migration_backup.publication_created_at b
where b.migration_id = '20260823172000'
  and b.novel_id = n.id::text;

alter table public.novels drop column if exists first_published_at;

delete from novelrise_migration_backup.publication_created_at
where migration_id = '20260823172000';

commit;
