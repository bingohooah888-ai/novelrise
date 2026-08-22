\set ON_ERROR_STOP on

-- Newly added Stripe/subscription fields inherit the existing profile billing guard.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

do $$
begin
  begin
    update public.profiles
    set stripe_subscription_id = 'sub_hijacked'
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'user unexpectedly changed stripe_subscription_id';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

do $$
begin
  begin
    update public.profiles
    set subscription_status = 'active',
        subscription_cancel_at_period_end = true,
        subscription_current_period_end = now() + interval '30 days'
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'user unexpectedly changed subscription lifecycle fields';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

do $$
begin
  begin
    update public.profiles
    set stripe_last_event_created_at = 999999,
        stripe_last_event_id = 'evt_hijacked'
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'user unexpectedly changed Stripe event ordering fields';
  exception
    when sqlstate '42501' then null;
  end;
end
$$;

reset role;

-- Administrative webhook writes remain possible.
update public.profiles
set stripe_subscription_id = 'sub_admin_test',
    subscription_status = 'active',
    subscription_cancel_at_period_end = false,
    stripe_last_event_created_at = 123,
    stripe_last_event_id = 'evt_admin_test'
where id = '33333333-3333-3333-3333-333333333333';

select public.test_assert(
  exists (
    select 1
    from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'
      and stripe_subscription_id = 'sub_admin_test'
      and subscription_status = 'active'
      and stripe_last_event_id = 'evt_admin_test'
  ),
  'administrative Stripe lifecycle updates must remain possible'
);

select 'PASS: Stripe lifecycle fields are protected from browser updates' as result;
