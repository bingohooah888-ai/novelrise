\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_chapters') is null then
    raise exception 'public.novel_chapters was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novel_chapters'::regclass) then
    raise exception 'RLS is not enabled on public.novel_chapters';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'chapter_id'
  ) then
    raise exception 'episodes.chapter_id was not created';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.episodes'::regclass
       and conname = 'episodes_chapter_same_novel_fk'
       and contype = 'f'
  ) then
    raise exception 'Same-novel chapter FK is missing';
  end if;

  if has_table_privilege('anon', 'public.novel_chapters', 'SELECT') then
    raise exception 'anon must not receive raw novel_chapters SELECT';
  end if;
  if not has_table_privilege('authenticated', 'public.novel_chapters', 'SELECT') then
    raise exception 'authenticated owners need raw chapter SELECT under RLS';
  end if;
  if has_table_privilege('authenticated', 'public.novel_chapters', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_chapters', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_chapters', 'DELETE') then
    raise exception 'Chapter mutations must stay behind bounded RPCs';
  end if;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'novel_chapters'
       and policyname = 'novel_chapters_select_owner'
       and cmd = 'SELECT'
  ) then
    raise exception 'Owner chapter SELECT policy is missing';
  end if;

  if to_regprocedure('public.novelight_create_novel_chapter(bigint,text)') is null
     or to_regprocedure('public.novelight_rename_novel_chapter(bigint,text)') is null
     or to_regprocedure('public.novelight_delete_novel_chapter(bigint)') is null
     or to_regprocedure('public.novelight_reorder_novel_structure(bigint,jsonb,jsonb)') is null
     or to_regprocedure('public.novelight_novel_outline(bigint)') is null then
    raise exception 'One or more chapter/ordering RPCs are missing';
  end if;

  if has_function_privilege('anon', 'public.novelight_create_novel_chapter(bigint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_rename_novel_chapter(bigint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_delete_novel_chapter(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_reorder_novel_structure(bigint,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'Anonymous users must not execute chapter mutation RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_create_novel_chapter(bigint,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_rename_novel_chapter(bigint,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_delete_novel_chapter(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_reorder_novel_structure(bigint,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'Authenticated users are missing chapter mutation RPC access';
  end if;

  if not has_function_privilege('service_role', 'public.novelight_create_novel_chapter(bigint,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_rename_novel_chapter(bigint,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_delete_novel_chapter(bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_reorder_novel_structure(bigint,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'service_role chapter mutation RPC grants are incomplete';
  end if;

  if not has_function_privilege('anon', 'public.novelight_novel_outline(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_novel_outline(bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_novel_outline(bigint)', 'EXECUTE') then
    raise exception 'Public outline RPC grants are incomplete';
  end if;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'novelight_create_novel_chapter',
         'novelight_rename_novel_chapter',
         'novelight_delete_novel_chapter',
         'novelight_reorder_novel_structure',
         'novelight_novel_outline'
       )
       and (
         not p.prosecdef
         or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=""%'
       )
  ) then
    raise exception 'Chapter/outline RPC security configuration is incomplete';
  end if;

  if exists (
    select 1
      from public.episodes
     where episode_number is null or episode_number < 1
  ) then
    raise exception 'Episode numbering became invalid';
  end if;
end
$$;
