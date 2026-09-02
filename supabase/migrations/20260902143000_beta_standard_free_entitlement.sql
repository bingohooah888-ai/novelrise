-- NOVELIGHT controlled beta: grant Standard without Stripe billing and allow beta Standard -> Premium checkout.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260902143000'));

create or replace function public.novelight_activate_beta_standard(
  p_user_id uuid
)
returns table (
  plan text,
  payment_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_profile public.profiles%rowtype;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22004',
      message = 'beta_standard_user_required';
  end if;

  select p.*
  into current_profile
  from public.profiles as p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'beta_standard_profile_not_found';
  end if;

  if current_profile.plan = 'premium' then
    raise exception using
      errcode = 'P0001',
      message = 'beta_standard_premium_active';
  end if;

  if current_profile.plan = 'standard'
     and current_profile.payment_status = 'beta_free' then
    return query select 'standard'::text, 'beta_free'::text;
    return;
  end if;

  if current_profile.plan <> 'free' then
    raise exception using
      errcode = 'P0001',
      message = 'beta_standard_paid_subscription_requires_sync';
  end if;

  if coalesce(current_profile.subscription_status, '') in (
    'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'beta_standard_entitled_subscription_exists';
  end if;

  update public.profiles
  set plan = 'standard',
      payment_status = 'beta_free'
  where id = p_user_id;

  delete from public.billing_checkout_attempts
  where user_id = p_user_id;

  return query select 'standard'::text, 'beta_free'::text;
end
$$;

revoke all on function public.novelight_activate_beta_standard(uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_activate_beta_standard(uuid)
  to service_role;

create or replace function public.novelight_reserve_checkout_attempt(
  p_user_id uuid,
  p_plan text,
  p_candidate_attempt_id uuid
)
returns table (
  attempt_id uuid,
  plan text,
  stripe_session_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  profile_plan text;
  profile_payment_status text;
  current_attempt public.billing_checkout_attempts%rowtype;
begin
  if p_user_id is null or p_candidate_attempt_id is null then
    raise exception using
      errcode = '22004',
      message = 'checkout_attempt_identifiers_required';
  end if;

  if p_plan not in ('standard', 'premium') then
    raise exception using
      errcode = '22023',
      message = 'checkout_attempt_invalid_plan';
  end if;

  select p.plan, p.payment_status
  into profile_plan, profile_payment_status
  from public.profiles as p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'checkout_profile_not_found';
  end if;

  if profile_plan <> 'free'
     and not (
       profile_plan = 'standard'
       and profile_payment_status = 'beta_free'
       and p_plan = 'premium'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'checkout_profile_not_free';
  end if;

  select a.*
  into current_attempt
  from public.billing_checkout_attempts as a
  where a.user_id = p_user_id;

  if found and current_attempt.expires_at > now() then
    if current_attempt.plan <> p_plan then
      raise exception using
        errcode = 'P0001',
        message = 'checkout_attempt_plan_conflict';
    end if;

    return query
    select
      current_attempt.attempt_id,
      current_attempt.plan,
      current_attempt.stripe_session_id,
      current_attempt.expires_at;
    return;
  end if;

  insert into public.billing_checkout_attempts as a (
    user_id,
    attempt_id,
    plan,
    stripe_session_id,
    expires_at,
    created_at,
    updated_at
  ) values (
    p_user_id,
    p_candidate_attempt_id,
    p_plan,
    null,
    now() + interval '23 hours',
    now(),
    now()
  )
  on conflict (user_id) do update
  set attempt_id = excluded.attempt_id,
      plan = excluded.plan,
      stripe_session_id = null,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

  return query
  select
    a.attempt_id,
    a.plan,
    a.stripe_session_id,
    a.expires_at
  from public.billing_checkout_attempts as a
  where a.user_id = p_user_id;
end
$$;

revoke all on function public.novelight_reserve_checkout_attempt(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_reserve_checkout_attempt(uuid, text, uuid)
  to service_role;

commit;
