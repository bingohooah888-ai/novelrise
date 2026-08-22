-- NOVELIGHT: precheck before billing/profile protection and novel plan limits.
-- Read-only. Abort on an unsafe or unexpected baseline.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null then
    raise exception 'Required tables public.profiles and public.novels must exist';
  end if;

  if to_regprocedure('auth.uid()') is null then
    raise exception 'Required function auth.uid() must exist';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'id',
        'display_name',
        'bio',
        'plan',
        'payment_status',
        'stripe_customer_id'
      )
  ) <> 6 then
    raise exception 'profiles is missing one or more required billing/profile columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novels'
      and column_name = 'user_id'
  ) then
    raise exception 'novels.user_id must exist';
  end if;

  if exists (
    select 1
    from public.profiles
    where plan is null
       or plan not in ('free', 'standard', 'premium')
  ) then
    raise exception 'profiles contains null or unsupported plan values';
  end if;

  if to_regprocedure('public.novelight_guard_profile_update()') is not null
     or to_regprocedure('public.novelight_enforce_novel_plan_limit()') is not null then
    raise exception 'Managed NOVELIGHT billing functions already exist';
  end if;

  if exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'novelight_guard_profile_update',
        'novelight_enforce_novel_plan_limit'
      )
  ) then
    raise exception 'Managed NOVELIGHT billing triggers already exist';
  end if;
end
$$;

select 'PASS: billing/profile baseline is safe for migration' as result;
