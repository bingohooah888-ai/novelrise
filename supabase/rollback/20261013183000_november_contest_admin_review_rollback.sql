-- Stop safely if an operator decision has already been written.
begin;
do $safe$
begin
  if exists (
    select 1 from public.novelight_contest_review_audit
     where action in (
       'operator_review_hold','operator_review_clear','operator_review_reopen'
     )
  ) then
    raise exception 'Manual review history exists; audited rollback required';
  end if;
end
$safe$;
drop function if exists public.novelight_contest_admin_review_reader(
  uuid,uuid,uuid,text,text,text,text
);
commit;
