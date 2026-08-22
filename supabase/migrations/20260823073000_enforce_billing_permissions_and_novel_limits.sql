-- NOVELIGHT: protect billing-owned profile fields and enforce plan novel limits.
-- This migration is additive and leaves existing content untouched.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823073000'));

create or replace function public.novelight_guard_profile_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth
as $$
begin
  if current_user = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'Anonymous profile updates are not allowed';
  end if;

  if current_user = 'authenticated' then
    if (select auth.uid()) is null
       or old.id is distinct from (select auth.uid()) then
      raise exception using
        errcode = '42501',
        message = 'Users may update only their own profile';
    end if;

    if new.id is distinct from old.id then
      raise exception using
        errcode = '42501',
        message = 'Profile ownership cannot be changed';
    end if;

    if exists (
      select 1
      from jsonb_each(to_jsonb(new)) as new_field(key, value)
      join jsonb_each(to_jsonb(old)) as old_field(key, value) using (key)
      where (
        new_field.key in ('plan', 'payment_status', 'stripe_customer_id')
        or left(new_field.key, 7) = 'stripe_'
        or left(new_field.key, 13) = 'subscription_'
        or left(new_field.key, 8) = 'billing_'
      )
      and new_field.value is distinct from old_field.value
    ) then
      raise exception using
        errcode = '42501',
        message = 'Billing-managed profile fields cannot be changed by the user';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_guard_profile_update() from public;

drop trigger if exists novelight_guard_profile_update on public.profiles;

create trigger novelight_guard_profile_update
before update on public.profiles
for each row
execute function public.novelight_guard_profile_update();

create or replace function public.novelight_enforce_novel_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  current_plan text;
  current_count integer;
  max_novels integer;
begin
  -- Administrative/import operations without an end-user JWT are not plan-gated.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.user_id is distinct from (select auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'Novel ownership must match the authenticated user';
  end if;

  -- Serialize inserts for the same author so concurrent requests cannot race
  -- past the plan limit.
  select p.plan
  into current_plan
  from public.profiles as p
  where p.id = new.user_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'A valid author profile is required before posting a novel';
  end if;

  max_novels := case current_plan
    when 'free' then 1
    when 'standard' then 10
    when 'premium' then 30
    else null
  end;

  if max_novels is null then
    raise exception using
      errcode = '23514',
      message = 'Unsupported billing plan; novel creation is blocked';
  end if;

  select count(*)::integer
  into current_count
  from public.novels as n
  where n.user_id = new.user_id;

  if current_count >= max_novels then
    raise exception using
      errcode = '23514',
      message = format(
        'Novel limit reached for %s plan (%s)',
        current_plan,
        max_novels
      );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_enforce_novel_plan_limit() from public;

drop trigger if exists novelight_enforce_novel_plan_limit on public.novels;

create trigger novelight_enforce_novel_plan_limit
before insert on public.novels
for each row
execute function public.novelight_enforce_novel_plan_limit();

commit;
