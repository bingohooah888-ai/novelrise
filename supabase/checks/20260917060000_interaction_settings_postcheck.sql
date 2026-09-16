-- Postcheck for 20260917060000_interaction_settings.sql
-- Read-only: verifies objects, RLS, privilege boundaries, and trigger enforcement wiring.

do $$
begin
  if to_regclass('public.author_interaction_defaults') is null
     or to_regclass('public.novel_interaction_settings') is null then
    raise exception 'POSTCHECK FAIL: interaction settings tables are missing';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'author_interaction_defaults'
       and c.relrowsecurity
  ) then
    raise exception 'POSTCHECK FAIL: author_interaction_defaults RLS is not enabled';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_interaction_settings'
       and c.relrowsecurity
  ) then
    raise exception 'POSTCHECK FAIL: novel_interaction_settings RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('anon', 'public.author_interaction_defaults', 'INSERT')
     or has_table_privilege('anon', 'public.author_interaction_defaults', 'UPDATE')
     or has_table_privilege('anon', 'public.author_interaction_defaults', 'DELETE')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'INSERT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'UPDATE')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'DELETE') then
    raise exception 'POSTCHECK FAIL: author_interaction_defaults raw table access is exposed';
  end if;

  if has_table_privilege('anon', 'public.novel_interaction_settings', 'SELECT')
     or has_table_privilege('anon', 'public.novel_interaction_settings', 'INSERT')
     or has_table_privilege('anon', 'public.novel_interaction_settings', 'UPDATE')
     or has_table_privilege('anon', 'public.novel_interaction_settings', 'DELETE')
     or has_table_privilege('authenticated', 'public.novel_interaction_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_interaction_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_interaction_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_interaction_settings', 'DELETE') then
    raise exception 'POSTCHECK FAIL: novel_interaction_settings raw table access is exposed';
  end if;

  if to_regprocedure('public.novelight_author_interaction_defaults()') is null
     or to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)') is null
     or to_regprocedure('public.novelight_author_novel_interaction_settings(text)') is null
     or to_regprocedure('public.novelight_set_novel_interaction_settings(text,boolean,boolean)') is null
     or to_regprocedure('public.novelight_novel_interaction_state(text)') is null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is null then
    raise exception 'POSTCHECK FAIL: interaction settings functions are missing';
  end if;

  if has_function_privilege('anon', 'public.novelight_author_interaction_defaults()', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_author_interaction_defaults(boolean,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_author_novel_interaction_settings(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_novel_interaction_settings(text,boolean,boolean)', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: author-only interaction RPC is exposed to anon';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_author_interaction_defaults()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_author_interaction_defaults(boolean,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_author_novel_interaction_settings(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_novel_interaction_settings(text,boolean,boolean)', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: authenticated role cannot execute author interaction RPCs';
  end if;

  if not has_function_privilege('anon', 'public.novelight_novel_interaction_state(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_novel_interaction_state(text)', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: reader interaction state RPC is not available to readers';
  end if;

  if has_function_privilege('anon', 'public._novelight_enforce_comment_reception()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._novelight_enforce_comment_reception()', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: trigger helper is directly executable by clients';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_comments'
       and t.tgname = 'novelight_enforce_comment_reception'
       and t.tgenabled <> 'D'
       and not t.tgisinternal
  ) then
    raise exception 'POSTCHECK FAIL: comment reception trigger is missing or disabled';
  end if;

  if exists (
    select 1
      from pg_proc p
     where p.oid in (
       to_regprocedure('public.novelight_author_interaction_defaults()'),
       to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)'),
       to_regprocedure('public.novelight_author_novel_interaction_settings(text)'),
       to_regprocedure('public.novelight_set_novel_interaction_settings(text,boolean,boolean)'),
       to_regprocedure('public.novelight_novel_interaction_state(text)'),
       to_regprocedure('public._novelight_enforce_comment_reception()')
     )
       and not p.prosecdef
  ) then
    raise exception 'POSTCHECK FAIL: an interaction function lost SECURITY DEFINER';
  end if;
end
$$;

select 'POSTCHECK PASS: interaction settings runtime is installed with expected boundaries' as result;
