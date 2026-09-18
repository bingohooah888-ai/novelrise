-- Postcheck for NOVELIGHT B #10 private reader bookshelf organization.

do $$
declare
  v_policy_count integer;
begin
  if to_regclass('public.reader_bookshelf_entries') is null then
    raise exception 'POSTCHECK FAIL: reader_bookshelf_entries is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.reader_bookshelf_entries'::regclass
  ) then
    raise exception 'POSTCHECK FAIL: bookshelf RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.reader_bookshelf_entries', 'SELECT')
     or has_table_privilege('anon', 'public.reader_bookshelf_entries', 'INSERT')
     or has_table_privilege('anon', 'public.reader_bookshelf_entries', 'UPDATE')
     or has_table_privilege('anon', 'public.reader_bookshelf_entries', 'DELETE') then
    raise exception 'POSTCHECK FAIL: anonymous bookshelf access is enabled';
  end if;

  if not has_table_privilege('authenticated', 'public.reader_bookshelf_entries', 'SELECT')
     or not has_table_privilege('authenticated', 'public.reader_bookshelf_entries', 'INSERT')
     or not has_table_privilege('authenticated', 'public.reader_bookshelf_entries', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.reader_bookshelf_entries', 'DELETE') then
    raise exception 'POSTCHECK FAIL: authenticated bookshelf CRUD grants are incomplete';
  end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'reader_bookshelf_entries'
    and policyname in (
      'reader_bookshelf_entries_select_own',
      'reader_bookshelf_entries_insert_own',
      'reader_bookshelf_entries_update_own',
      'reader_bookshelf_entries_delete_own'
    );

  if v_policy_count <> 4 then
    raise exception 'POSTCHECK FAIL: expected four own-only bookshelf policies';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.novelight_touch_reader_bookshelf_entry()',
    'EXECUTE'
  ) then
    raise exception 'POSTCHECK FAIL: trigger helper is client-executable';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.reader_bookshelf_entries'::regclass
      and tgname = 'reader_bookshelf_entries_touch'
      and not tgisinternal
  ) then
    raise exception 'POSTCHECK FAIL: bookshelf normalization trigger is missing';
  end if;

  if obj_description('public.reader_bookshelf_entries'::regclass)
     not like 'Private reader organization only;%' then
    raise exception 'POSTCHECK FAIL: privacy / neutrality table contract is missing';
  end if;
end
$$;

select 'POSTCHECK PASS: reader bookshelf is private and organization-only' as result;
