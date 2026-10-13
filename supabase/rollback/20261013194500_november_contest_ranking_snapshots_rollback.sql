-- Stage 08 safety rollback: never destroy published snapshots.
begin;
do $safe$
begin
  if exists (
    select 1 from public.novelight_contest_rank_snapshots
     where contest_id in (
       select id from public.novelight_contests
        where contest_key='novelight-november-2026'
     ) and status in ('published','retracted')
  ) then
    raise exception 'Published ranking history exists: audited recovery required';
  end if;
end
$safe$;
drop function if exists public.novelight_public_contest_rankings(boolean);
drop function if exists public.novelight_contest_publish_rank_snapshot(uuid,integer);
drop function if exists public.novelight_contest_prepare_rank_snapshot(uuid,integer);
drop function if exists public.novelight_contest_rank_slot_at(integer);
commit;
