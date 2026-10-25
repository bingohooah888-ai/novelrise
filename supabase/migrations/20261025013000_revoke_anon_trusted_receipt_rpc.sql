-- Reduce the externally callable SECURITY DEFINER surface.
-- This RPC explicitly requires auth.uid() and must never be executable as anon.
-- Keep authenticated and service_role grants unchanged.
begin;

revoke execute on function public.record_trusted_allocation_receipts(uuid[])
  from anon, public;

-- An isolated migration replay may not have the Production ACL snapshot.
-- Make the two intentional grants explicit rather than inheriting from PUBLIC.
grant execute on function public.record_trusted_allocation_receipts(uuid[])
  to authenticated, service_role;

do $verify$
begin
  if has_function_privilege(
    'anon',
    'public.record_trusted_allocation_receipts(uuid[])',
    'EXECUTE'
  ) then
    raise exception 'Security invariant failed: anon can execute trusted receipt RPC';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.record_trusted_allocation_receipts(uuid[])',
    'EXECUTE'
  ) then
    raise exception 'Regression: authenticated receipt RPC execution was revoked';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.record_trusted_allocation_receipts(uuid[])',
    'EXECUTE'
  ) then
    raise exception 'Regression: service-role receipt RPC execution was revoked';
  end if;
end;
$verify$;

commit;
