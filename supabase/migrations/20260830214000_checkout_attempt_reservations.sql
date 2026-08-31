-- NOVELIGHT: serialize subscription Checkout attempts per author.
-- Keeps pending billing state server-only and reusable across serverless instances.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260830214000'));

create table public.billing_checkout_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  attempt_id uuid not null,
  plan text not null check (plan in ('standard', 'premium')),
  stripe_session_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_checkout_attempts_session_unique unique (stripe_session_id)
);

alter table public.billing_checkout_attempts enable row level security;

revoke all on table public.billing_checkout_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_checkout_attempts to service_role;

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

create or replace function public.novelight_attach_checkout_session(
  p_user_id uuid,
  p_attempt_id uuid,
  p_stripe_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_stripe_session_id is null or btrim(p_stripe_session_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'checkout_session_id_required';
  end if;

  update public.billing_checkout_attempts
  set stripe_session_id = p_stripe_session_id,
      updated_at = now()
  where user_id = p_user_id
    and attempt_id = p_attempt_id
    and expires_at > now()
    and (
      stripe_session_id is null
      or stripe_session_id = p_stripe_session_id
    );

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'checkout_attempt_not_current';
  end if;

  return true;
end
$$;

revoke all on function public.novelight_attach_checkout_session(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.novelight_attach_checkout_session(uuid, uuid, text)
  to service_role;

create or replace function public.novelight_release_checkout_attempt(
  p_user_id uuid,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  delete from public.billing_checkout_attempts
  where user_id = p_user_id
    and attempt_id = p_attempt_id;

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end
$$;

revoke all on function public.novelight_release_checkout_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_release_checkout_attempt(uuid, uuid)
  to service_role;

commit;
