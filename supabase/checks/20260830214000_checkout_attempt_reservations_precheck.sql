-- NOVELIGHT: read-only precheck for Checkout attempt reservations.

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Required table public.profiles must exist';
  end if;

  if to_regclass('public.billing_checkout_attempts') is not null
     or to_regprocedure(
       'public.novelight_reserve_checkout_attempt(uuid,text,uuid)'
     ) is not null
     or to_regprocedure(
       'public.novelight_attach_checkout_session(uuid,uuid,text)'
     ) is not null
     or to_regprocedure(
       'public.novelight_release_checkout_attempt(uuid,uuid)'
     ) is not null then
    raise exception 'Checkout attempt reservation schema already exists or migration is partial';
  end if;
end
$$;

select 'PASS: Checkout attempt reservation baseline is safe for migration' as result;
