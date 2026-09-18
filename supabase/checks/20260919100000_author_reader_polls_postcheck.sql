\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_polls') is null
     or to_regclass('public.novel_poll_options') is null
     or to_regclass('public.novel_poll_votes') is null then
    raise exception 'POSTCHECK FAIL: B #20 reader poll tables missing';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.novel_polls'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.novel_poll_options'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.novel_poll_votes'::regclass) then
    raise exception 'POSTCHECK FAIL: B #20 poll RLS disabled';
  end if;
  if has_table_privilege('anon','public.novel_polls','select')
     or has_table_privilege('authenticated','public.novel_polls','select')
     or has_table_privilege('authenticated','public.novel_poll_options','select')
     or has_table_privilege('authenticated','public.novel_poll_votes','select')
     or has_table_privilege('authenticated','public.novel_poll_votes','insert')
     or has_table_privilege('service_role','public.novel_poll_votes','select') then
    raise exception 'POSTCHECK FAIL: raw B #20 poll privileges leaked';
  end if;
  if not has_function_privilege('anon','public.novelight_public_novel_poll(bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_public_novel_poll(bigint)','execute')
     or has_function_privilege('anon','public.novelight_manage_my_novel_polls(bigint,integer)','execute')
     or has_function_privilege('anon','public.novelight_create_my_novel_poll(bigint,text,text[])','execute')
     or has_function_privilege('anon','public.novelight_close_my_novel_poll(bigint)','execute')
     or has_function_privilege('anon','public.novelight_vote_novel_poll(bigint,bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_manage_my_novel_polls(bigint,integer)','execute')
     or not has_function_privilege('authenticated','public.novelight_create_my_novel_poll(bigint,text,text[])','execute')
     or not has_function_privilege('authenticated','public.novelight_close_my_novel_poll(bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_vote_novel_poll(bigint,bigint)','execute') then
    raise exception 'POSTCHECK FAIL: B #20 poll RPC privileges incorrect';
  end if;
  raise notice 'POSTCHECK PASS: B #20 polls are private, RPC-only, owner-bound, and vote-private';
end
$$;
