-- MANUAL RECOVERY ONLY: use a separate exact-target approval.
-- Drop ONLY the new functions. No CASCADE, follow relationship rows untouched.
begin;
do $follow_list_rollback_guard$
declare
  v_fn text;
  v_oid oid;
begin
  foreach v_fn in array array[
    'public.novelight_followed_authors(integer,integer)',
    'public.novelight_followers(integer,integer)',
    'public.novelight_follow_counts()'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_fn);
    if v_oid is null or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_oid and p.prosecdef
        and p.proconfig @> array['search_path=""']::text[]
    ) then
      raise exception 'Follow list rollback blocked: unexpected RPC state: %', v_fn;
    end if;
  end loop;
end
$follow_list_rollback_guard$;

drop function public.novelight_followed_authors(integer,integer);
drop function public.novelight_followers(integer,integer);
drop function public.novelight_follow_counts();
commit;
