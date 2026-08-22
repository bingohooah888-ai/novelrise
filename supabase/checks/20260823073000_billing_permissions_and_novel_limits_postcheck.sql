-- NOVELIGHT: verification after 20260823073000.
-- Read-only. Fails when billing/profile guards are not installed as designed.

do $$
declare
  profile_trigger_count integer;
  novel_trigger_count integer;
  profile_function_security boolean;
  novel_function_security boolean;
begin
  select count(*) into profile_trigger_count
  from pg_trigger
  where not tgisinternal
    and tgrelid = 'public.profiles'::regclass
    and tgname = 'novelight_guard_profile_update';

  if profile_trigger_count <> 1 then
    raise exception 'Expected exactly one profile billing guard trigger, found %', profile_trigger_count;
  end if;

  select count(*) into novel_trigger_count
  from pg_trigger
  where not tgisinternal
    and tgrelid = 'public.novels'::regclass
    and tgname = 'novelight_enforce_novel_plan_limit';

  if novel_trigger_count <> 1 then
    raise exception 'Expected exactly one novel plan-limit trigger, found %', novel_trigger_count;
  end if;

  select prosecdef into profile_function_security
  from pg_proc
  where oid = 'public.novelight_guard_profile_update()'::regprocedure;

  if profile_function_security is distinct from false then
    raise exception 'Profile guard must remain SECURITY INVOKER';
  end if;

  select prosecdef into novel_function_security
  from pg_proc
  where oid = 'public.novelight_enforce_novel_plan_limit()'::regprocedure;

  if novel_function_security is distinct from true then
    raise exception 'Novel plan-limit function must be SECURITY DEFINER';
  end if;
end
$$;

select 'PASS: billing/profile guards are installed' as result;
