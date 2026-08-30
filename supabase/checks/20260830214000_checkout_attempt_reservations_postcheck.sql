-- NOVELIGHT: verify Checkout attempt reservation schema and permissions.

do $$
begin
  if to_regclass('public.billing_checkout_attempts') is null then
    raise exception 'billing_checkout_attempts table is missing';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.billing_checkout_attempts'::regclass
      and relrowsecurity
  ) then
    raise exception 'billing_checkout_attempts must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.billing_checkout_attempts', 'select')
     or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'select')
     or has_table_privilege('anon', 'public.billing_checkout_attempts', 'insert')
     or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'insert')
     or has_table_privilege('anon', 'public.billing_checkout_attempts', 'update')
     or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'update')
     or has_table_privilege('anon', 'public.billing_checkout_attempts', 'delete')
     or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'delete') then
    raise exception 'Checkout attempt table leaked client privileges';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.billing_checkout_attempts',
    'select,insert,update,delete'
  ) then
    raise exception 'service_role is missing Checkout attempt table privileges';
  end if;

  if to_regprocedure(
       'public.novelight_reserve_checkout_attempt(uuid,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.novelight_attach_checkout_session(uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'public.novelight_release_checkout_attempt(uuid,uuid)'
     ) is null then
    raise exception 'One or more Checkout attempt RPCs are missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.novelight_reserve_checkout_attempt(uuid,text,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.novelight_reserve_checkout_attempt(uuid,text,uuid)',
       'execute'
     ) then
    raise exception 'Checkout reservation RPC is executable by browser roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.novelight_reserve_checkout_attempt(uuid,text,uuid)',
    'execute'
  ) then
    raise exception 'service_role cannot execute Checkout reservation RPC';
  end if;
end
$$;

select 'PASS: Checkout attempt reservations are server-only and complete' as result;
