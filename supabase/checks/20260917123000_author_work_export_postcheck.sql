do $$
declare
  v_rls boolean;
  v_definition text;
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

  if to_regprocedure('public.novelight_authorize_work_export(bigint,text)') is null then
    raise exception 'novelight_authorize_work_export function is missing';
  end if;

  select lower(pg_get_functiondef('public.novelight_authorize_work_export(bigint,text)'::regprocedure))
    into v_definition;

  if position('auth.uid()' in v_definition) = 0 then
    raise exception 'author export authorization is not bound to auth.uid()';
  end if;

  if position('n.user_id = v_uid' in v_definition) = 0 then
    raise exception 'author export ownership check is missing';
  end if;

  if position("interval '10 minutes'" in v_definition) = 0
     or position("interval '24 hours'" in v_definition) = 0 then
    raise exception 'author export rate limits are missing';
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

  if has_function_privilege('anon', 'public.novelight_authorize_work_export(bigint,text)', 'EXECUTE') then
    raise exception 'anonymous role can execute author export authorization';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_authorize_work_export(bigint,text)', 'EXECUTE') then
    raise exception 'authenticated role cannot execute author export authorization';
  end if;
end
$$;
