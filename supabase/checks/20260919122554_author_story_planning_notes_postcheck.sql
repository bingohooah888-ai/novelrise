do $$
declare
  v_func oid;
begin
  if to_regclass('public.novel_private_story_notes') is null then
    raise exception 'POSTCHECK FAIL: B #23 note table missing';
  end if;

  if not (
    select relrowsecurity
      from pg_class
     where oid='public.novel_private_story_notes'::regclass
  ) then
    raise exception 'POSTCHECK FAIL: B #23 RLS disabled';
  end if;

  if has_table_privilege('anon','public.novel_private_story_notes','select')
     or has_table_privilege('authenticated','public.novel_private_story_notes','select')
     or has_table_privilege('authenticated','public.novel_private_story_notes','insert')
     or has_table_privilege('authenticated','public.novel_private_story_notes','update')
     or has_table_privilege('authenticated','public.novel_private_story_notes','delete')
     or has_table_privilege('service_role','public.novel_private_story_notes','select') then
    raise exception 'POSTCHECK FAIL: raw B #23 table privileges leaked';
  end if;

  if has_function_privilege('anon','public.novelight_private_story_notes(bigint)','execute')
     or has_function_privilege('anon','public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)','execute')
     or has_function_privilege('anon','public.novelight_delete_private_story_note(bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_private_story_notes(bigint)','execute')
     or not has_function_privilege('authenticated','public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)','execute')
     or not has_function_privilege('authenticated','public.novelight_delete_private_story_note(bigint)','execute') then
    raise exception 'POSTCHECK FAIL: B #23 RPC privileges incorrect';
  end if;

  foreach v_func in array array[
    to_regprocedure('public.novelight_private_story_notes(bigint)')::oid,
    to_regprocedure('public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text)')::oid,
    to_regprocedure('public.novelight_delete_private_story_note(bigint)')::oid
  ]
  loop
    if not exists (
      select 1
        from pg_proc p
       where p.oid=v_func
         and p.prosecdef
         and p.proconfig @> array['search_path=""']::text[]
    ) then
      raise exception 'POSTCHECK FAIL: B #23 RPC security/search_path hardening missing';
    end if;
  end loop;

  raise notice 'POSTCHECK PASS: B #23 is owner-only, raw-private, authenticated-RPC-only';
end
$$;