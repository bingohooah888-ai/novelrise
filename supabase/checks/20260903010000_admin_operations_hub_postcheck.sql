\set ON_ERROR_STOP on

do $$
declare
  v_announcements_rls boolean;
  v_audit_rls boolean;
begin
  if to_regclass('public.announcements') is null then
    raise exception 'Postcheck failed: public.announcements is missing';
  end if;

  if to_regclass('public.admin_operation_audit') is null then
    raise exception 'Postcheck failed: public.admin_operation_audit is missing';
  end if;

  select relrowsecurity into v_announcements_rls
    from pg_class where oid = 'public.announcements'::regclass;
  select relrowsecurity into v_audit_rls
    from pg_class where oid = 'public.admin_operation_audit'::regclass;

  if not coalesce(v_announcements_rls, false) or not coalesce(v_audit_rls, false) then
    raise exception 'Postcheck failed: ADMIN operations tables must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.announcements', 'SELECT')
     or has_table_privilege('anon', 'public.announcements', 'INSERT')
     or has_table_privilege('anon', 'public.announcements', 'UPDATE')
     or has_table_privilege('anon', 'public.announcements', 'DELETE')
     or has_table_privilege('authenticated', 'public.announcements', 'SELECT')
     or has_table_privilege('authenticated', 'public.announcements', 'INSERT')
     or has_table_privilege('authenticated', 'public.announcements', 'UPDATE')
     or has_table_privilege('authenticated', 'public.announcements', 'DELETE') then
    raise exception 'Postcheck failed: client roles have direct announcements privileges';
  end if;

  if has_table_privilege('anon', 'public.admin_operation_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.admin_operation_audit', 'SELECT') then
    raise exception 'Postcheck failed: client roles can read ADMIN audit rows';
  end if;

  if has_function_privilege('anon', 'public.novelight_admin_create_announcement(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_admin_create_announcement(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_admin_update_announcement(uuid,bigint,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_admin_update_announcement(uuid,bigint,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_admin_update_contact_inquiry_status(uuid,bigint,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_admin_update_contact_inquiry_status(uuid,bigint,text)', 'EXECUTE') then
    raise exception 'Postcheck failed: client roles can execute ADMIN mutation RPCs';
  end if;

  if not has_function_privilege('service_role', 'public.novelight_admin_create_announcement(uuid,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_admin_update_announcement(uuid,bigint,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_admin_update_contact_inquiry_status(uuid,bigint,text)', 'EXECUTE') then
    raise exception 'Postcheck failed: service_role cannot execute ADMIN mutation RPCs';
  end if;

  if has_table_privilege('anon', 'public.contact_inquiries', 'SELECT')
     or has_table_privilege('authenticated', 'public.contact_inquiries', 'SELECT') then
    raise exception 'Postcheck failed: contact inquiry privacy boundary regressed';
  end if;
end
$$;
