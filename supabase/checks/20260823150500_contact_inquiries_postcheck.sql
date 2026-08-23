\set ON_ERROR_STOP on

do $$
declare
  v_rls_enabled boolean;
  v_security_definer boolean;
begin
  if to_regclass('public.contact_inquiries') is null then
    raise exception 'Postcheck failed: public.contact_inquiries is missing';
  end if;

  if to_regprocedure('public.submit_contact_inquiry(text,text,text,text,text)') is null then
    raise exception 'Postcheck failed: submit_contact_inquiry is missing';
  end if;

  select relrowsecurity
    into v_rls_enabled
    from pg_class
   where oid = 'public.contact_inquiries'::regclass;

  if not coalesce(v_rls_enabled, false) then
    raise exception 'Postcheck failed: RLS is not enabled on contact_inquiries';
  end if;

  if has_table_privilege('anon', 'public.contact_inquiries', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.contact_inquiries', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Postcheck failed: client roles have direct contact_inquiries privileges';
  end if;

  if not has_function_privilege(
    'anon',
    'public.submit_contact_inquiry(text,text,text,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.submit_contact_inquiry(text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Postcheck failed: client roles cannot execute submit_contact_inquiry';
  end if;

  select prosecdef
    into v_security_definer
    from pg_proc
   where oid = 'public.submit_contact_inquiry(text,text,text,text,text)'::regprocedure;

  if not coalesce(v_security_definer, false) then
    raise exception 'Postcheck failed: submit_contact_inquiry is not SECURITY DEFINER';
  end if;
end
$$;
