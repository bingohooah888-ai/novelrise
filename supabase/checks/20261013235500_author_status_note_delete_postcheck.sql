\set ON_ERROR_STOP on

do $$
declare
  v_function regprocedure :=
    to_regprocedure('public.novelight_delete_my_author_note(bigint)');
begin
  if v_function is null then
    raise exception 'POSTCHECK FAIL: owner delete RPC missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = v_function
      and prosecdef
      and proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'POSTCHECK FAIL: delete RPC security definer/search_path contract incorrect';
  end if;

  if has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE')
     or not has_function_privilege('authenticated', v_function, 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: delete RPC execute privileges incorrect';
  end if;

  if has_table_privilege('authenticated', 'public.author_notes', 'DELETE')
     or has_table_privilege('anon', 'public.author_notes', 'DELETE') then
    raise exception 'POSTCHECK FAIL: raw table delete unexpectedly granted';
  end if;

  raise notice 'POSTCHECK PASS: author note deletion remains owner-bound and RPC-only';
end
$$;
