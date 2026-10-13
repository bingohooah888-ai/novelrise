-- Stage 06 rollback: NEVER silently undo an already-linked identity.
begin;
do $safe$
begin
  if exists (
    select 1 from public.novelight_contest_readers
     where review_status = 'merged' and merged_into_reader_id is not null
  ) then
    raise exception 'Guest links exist: manual audited recovery required';
  end if;
end
$safe$;
drop function if exists public.novelight_contest_link_guest_account(
  uuid,text,uuid
);
commit;
