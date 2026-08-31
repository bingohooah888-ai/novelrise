\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.billing_checkout_attempts') is not null then
    raise exception 'Checkout attempt table survived rollback';
  end if;

  if to_regprocedure(
       'public.novelight_reserve_checkout_attempt(uuid,text,uuid)'
     ) is not null
     or to_regprocedure(
       'public.novelight_attach_checkout_session(uuid,uuid,text)'
     ) is not null
     or to_regprocedure(
       'public.novelight_release_checkout_attempt(uuid,uuid)'
     ) is not null then
    raise exception 'Checkout attempt RPC survived rollback';
  end if;
end
$$;

select 'PASS: Checkout attempt reservation rollback removed all objects' as result;
