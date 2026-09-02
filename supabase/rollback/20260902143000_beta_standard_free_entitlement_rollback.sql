-- NOVELIGHT controlled beta: rollback the cardless Standard entitlement schema changes.
-- This rollback is intentionally fail-closed once beta-free Standard profiles exist;
-- reconcile those profiles explicitly before restoring the pre-beta checkout contract.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260902143000:rollback'));

do $$
begin
  if exists (
    select 1
    from public.profiles
    where plan = 'standard'
      and payment_status = 'beta_free'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'beta_standard_rollback_requires_profile_reconciliation';
  end if;
end
$$;

drop function if exists public.novelight_activate_beta_standard(uuid);

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

  select p.plan
  into profile_plan
  from public.profiles as p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'checkout_profile_not_found';
  end if;

  if profile_plan <> 'free' then
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
