\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.reader_curation_lists') is null
     or to_regclass('public.reader_curation_list_items') is null then
    raise exception 'POSTCHECK FAIL: B #21 tables missing';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.reader_curation_lists'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.reader_curation_list_items'::regclass) then
    raise exception 'POSTCHECK FAIL: B #21 RLS disabled';
  end if;
  if has_table_privilege('anon','public.reader_curation_lists','select')
     or has_table_privilege('authenticated','public.reader_curation_lists','select')
     or has_table_privilege('authenticated','public.reader_curation_list_items','select')
     or has_table_privilege('authenticated','public.reader_curation_list_items','insert')
     or has_table_privilege('service_role','public.reader_curation_lists','select') then
    raise exception 'POSTCHECK FAIL: raw B #21 privileges leaked';
  end if;

  if not has_function_privilege('anon','public.novelight_public_reader_curation(uuid)','execute')
     or not has_function_privilege('authenticated','public.novelight_public_reader_curation(uuid)','execute')
     or has_function_privilege('anon','public.novelight_manage_my_curation_lists()','execute')
     or has_function_privilege('anon','public.novelight_create_my_curation_list(text,text)','execute')
     or not has_function_privilege('authenticated','public.novelight_manage_my_curation_lists()','execute')
     or not has_function_privilege('authenticated','public.novelight_create_my_curation_list(text,text)','execute')
     or not has_function_privilege('authenticated','public.novelight_update_my_curation_list(bigint,text,text,text)','execute')
     or not has_function_privilege('authenticated','public.novelight_add_my_curation_item(bigint,bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_remove_my_curation_item(bigint,bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_rotate_my_curation_share_token(bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_delete_my_curation_list(bigint)','execute') then
    raise exception 'POSTCHECK FAIL: B #21 RPC privileges incorrect';
  end if;
  raise notice 'POSTCHECK PASS: B #21 curation is raw-private, owner-managed, and share-token-bound';
end
$$;
