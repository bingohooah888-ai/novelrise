-- Postcheck for 20260918164000_interaction_reception_settings.sql

do $$
declare
  v_missing_typo integer;
begin
  if to_regclass('public.author_interaction_defaults') is null
     or to_regclass('public.novel_comment_reception_settings') is null then
    raise exception 'POSTCHECK FAIL: interaction settings tables are missing';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_typo_report_settings'
       and column_name = 'inherits_author_default'
       and is_nullable = 'NO'
  ) then
    raise exception 'POSTCHECK FAIL: typo inheritance column is missing or nullable';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'author_interaction_defaults'
       and c.relrowsecurity
  ) or not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_comment_reception_settings'
       and c.relrowsecurity
  ) then
    raise exception 'POSTCHECK FAIL: interaction settings RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('anon', 'public.novel_comment_reception_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'INSERT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'UPDATE')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'DELETE')
     or has_table_privilege('authenticated', 'public.novel_comment_reception_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_comment_reception_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_comment_reception_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_comment_reception_settings', 'DELETE') then
    raise exception 'POSTCHECK FAIL: raw interaction preference tables are client-accessible';
  end if;

  if to_regprocedure('public.novelight_author_interaction_defaults()') is null
     or to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)') is null
     or to_regprocedure('public.novelight_author_novel_interaction_settings(bigint)') is null
     or to_regprocedure('public.novelight_set_novel_interaction_settings(bigint,boolean,boolean)') is null
     or to_regprocedure('public.novelight_novel_comment_reception_state(bigint)') is null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is null
     or to_regprocedure('public._novelight_seed_typo_reception_for_novel()') is null then
    raise exception 'POSTCHECK FAIL: interaction settings functions are missing';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.novelight_author_interaction_defaults()',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_set_author_interaction_defaults(boolean,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_author_novel_interaction_settings(bigint)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_set_novel_interaction_settings(bigint,boolean,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_novel_comment_reception_state(bigint)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'anon',
       'public.novelight_novel_comment_reception_state(bigint)',
       'EXECUTE'
     ) then
    raise exception 'POSTCHECK FAIL: expected interaction RPC grant is missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.novelight_author_interaction_defaults()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_set_author_interaction_defaults(boolean,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_author_novel_interaction_settings(bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_set_novel_interaction_settings(bigint,boolean,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._novelight_enforce_comment_reception()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._novelight_seed_typo_reception_for_novel()',
       'EXECUTE'
     ) then
    raise exception 'POSTCHECK FAIL: internal interaction function is over-granted';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_comments'
       and t.tgname = 'novelight_enforce_comment_reception'
       and not t.tgisinternal
  ) then
    raise exception 'POSTCHECK FAIL: comment reception trigger is missing';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novels'
       and t.tgname = 'novelight_seed_typo_reception_for_novel'
       and not t.tgisinternal
  ) then
    raise exception 'POSTCHECK FAIL: typo inheritance seed trigger is missing';
  end if;

  select count(*)::integer
    into v_missing_typo
    from public.novels n
   where not exists (
     select 1
       from public.novel_typo_report_settings s
      where s.novel_id = n.id
   );

  if v_missing_typo <> 0 then
    raise exception 'POSTCHECK FAIL: one or more novels lack materialized typo reception state';
  end if;
end
$$;

select 'POSTCHECK PASS: B #11 interaction reception is private, inherited, and comment-gated' as result;
