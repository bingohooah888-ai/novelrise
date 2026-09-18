\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.author_notes') is null then
    raise exception 'POSTCHECK FAIL: author_notes table missing';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.author_notes'::regclass) then
    raise exception 'POSTCHECK FAIL: author_notes RLS disabled';
  end if;
  if has_table_privilege('anon','public.author_notes','select')
     or has_table_privilege('authenticated','public.author_notes','select')
     or has_table_privilege('authenticated','public.author_notes','insert')
     or has_table_privilege('service_role','public.author_notes','select')
     or has_table_privilege('service_role','public.author_notes','insert') then
    raise exception 'POSTCHECK FAIL: raw author_notes privileges leaked';
  end if;
  if not has_function_privilege('anon','public.novelight_public_author_notes(uuid,integer)','execute')
     or not has_function_privilege('authenticated','public.novelight_public_author_notes(uuid,integer)','execute')
     or has_function_privilege('anon','public.novelight_manage_my_author_notes(integer)','execute')
     or has_function_privilege('anon','public.novelight_save_my_author_note(bigint,text,text,bigint)','execute')
     or has_function_privilege('anon','public.novelight_archive_my_author_note(bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_manage_my_author_notes(integer)','execute')
     or not has_function_privilege('authenticated','public.novelight_save_my_author_note(bigint,text,text,bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_archive_my_author_note(bigint)','execute') then
    raise exception 'POSTCHECK FAIL: author note RPC privileges incorrect';
  end if;
  raise notice 'POSTCHECK PASS: author notes are private, RPC-only, owner-bound, and public-link safe';
end
$$;
