\set ON_ERROR_STOP on

set role service_role;

do $$
declare
  first_attempt uuid;
  follower_attempt uuid;
  other_user_attempt uuid;
  renewed_attempt uuid;
  attached_session text;
  conflict_seen boolean := false;
begin
  select r.attempt_id
  into first_attempt
  from public.novelight_reserve_checkout_attempt(
    '66666666-6666-6666-6666-666666666666',
    'standard',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) as r;

  select r.attempt_id
  into follower_attempt
  from public.novelight_reserve_checkout_attempt(
    '66666666-6666-6666-6666-666666666666',
    'standard',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) as r;

  if first_attempt <> follower_attempt then
    raise exception 'Concurrent-equivalent reservations did not reuse one attempt';
  end if;

  begin
    perform public.novelight_reserve_checkout_attempt(
      '66666666-6666-6666-6666-666666666666',
      'premium',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    );
  exception
    when others then
      if sqlerrm = 'checkout_attempt_plan_conflict' then
        conflict_seen := true;
      else
        raise;
      end if;
  end;

  if not conflict_seen then
    raise exception 'A second plan was allowed while an attempt was active';
  end if;

  perform public.novelight_attach_checkout_session(
    '66666666-6666-6666-6666-666666666666',
    first_attempt,
    'cs_test_checkout_reservation'
  );

  select r.stripe_session_id
  into attached_session
  from public.novelight_reserve_checkout_attempt(
    '66666666-6666-6666-6666-666666666666',
    'standard',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) as r;

  if attached_session <> 'cs_test_checkout_reservation' then
    raise exception 'Attached Checkout session was not retained on reuse';
  end if;

  select r.attempt_id
  into other_user_attempt
  from public.novelight_reserve_checkout_attempt(
    '77777777-7777-7777-7777-777777777777',
    'standard',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  ) as r;

  if other_user_attempt = first_attempt then
    raise exception 'Checkout reservations were not isolated per user';
  end if;

  update public.billing_checkout_attempts
  set expires_at = now() - interval '1 second'
  where user_id = '66666666-6666-6666-6666-666666666666';

  select r.attempt_id
  into renewed_attempt
  from public.novelight_reserve_checkout_attempt(
    '66666666-6666-6666-6666-666666666666',
    'standard',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  ) as r;

  if renewed_attempt = first_attempt then
    raise exception 'Expired Checkout attempt was not renewed';
  end if;

  if not public.novelight_release_checkout_attempt(
    '66666666-6666-6666-6666-666666666666',
    renewed_attempt
  ) then
    raise exception 'Current Checkout attempt could not be released';
  end if;

  delete from public.billing_checkout_attempts
  where user_id = '77777777-7777-7777-7777-777777777777';
end
$$;

reset role;

select 'PASS: Checkout attempt reservations serialize, isolate, renew, and release safely' as result;
