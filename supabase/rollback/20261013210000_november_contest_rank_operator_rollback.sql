-- Refuse to erase functions after any human release decision.
begin;
do $guard$
begin
  if exists (
    select 1 from public.novelight_contest_review_audit
     where action in ('operator_rank_prepare','operator_rank_publish')
  ) then
    raise exception 'Operator ranking audit exists: audited rollback required';
  end if;
end
$guard$;
drop function if exists public.novelight_contest_admin_rank_action(
  uuid,integer,uuid,text,uuid,text,text
);
drop function if exists public.novelight_contest_rank_release_preview(
  uuid,integer
);
commit;
