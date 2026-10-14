-- Roll back only the read-only operator overview introduced by Step 09.
-- No contest state, award records or payment records are touched.
begin;
drop function if exists
  public.novelight_contest_admin_operations_overview(uuid,text,integer,integer);
commit;
