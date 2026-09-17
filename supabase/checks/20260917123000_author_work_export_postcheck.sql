do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.author_work_export_audit') is null then
    raise exception 'author_work_export_audit table is missing';
  end if;

  select c.relrowsecurity
    into v_rls
    from pg_class c
   where c.oid = 'public.author_work_export_audit'::regclass;

  if coalesce(v_rls, false) is not true then
    raise exception 'author_work_export_audit RLS is not enabled';
  end if;

  if to_regprocedure('public.novelight_authorize_work_export(uuid,bigint,text)') is null then
    raise exception 'novelight_authorize_work_export function is missing';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'author_work_export_audit'
       and indexname = 'author_work_export_audit_user_requested_idx'
  ) then
    raise exception 'author export user/rate-limit index is missing';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'author_work_export_audit'
       and indexname = 'author_work_export_audit_novel_requested_idx'
  ) then
    raise exception 'author export novel FK index is missing';
  end if;

  if has_table_privilege('anon', 'public.author_work_export_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_work_export_audit', 'SELECT')
     or has_table_privilege('anon', 'public.author_work_export_audit', 'INSERT')
     or has_table_privilege('authenticated', 'public.author_work_export_audit', 'INSERT') then
    raise exception 'client role has direct author export audit access';
  end if;

  if has_function_privilege('anon', 'public.novelight_authorize_work_export(uuid,bigint,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_authorize_work_export(uuid,bigint,text)', 'EXECUTE') then
    raise exception 'client role can execute author export authorization';
  end if;

  if not has_function_privilege('service_role', 'public.novelight_authorize_work_export(uuid,bigint,text)', 'EXECUTE') then
    raise exception 'service_role cannot execute author export authorization';
  end if;
end
$$;
