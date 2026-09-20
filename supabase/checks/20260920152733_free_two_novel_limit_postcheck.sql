-- NOVELIGHT: read-only verification after raising the Free novel limit.

do $$
declare
  function_body text;
  function_security boolean;
  trigger_count integer;
begin
  if to_regprocedure('public.novelight_enforce_novel_plan_limit()') is null then
    raise exception 'Novel plan-limit function is missing after migration';
  end if;

  select p.prosrc, p.prosecdef
  into function_body, function_security
  from pg_proc p
  where p.oid = 'public.novelight_enforce_novel_plan_limit()'::regprocedure;

  if function_security is distinct from true then
    raise exception 'Novel plan-limit function must remain SECURITY DEFINER';
  end if;

  if position('when ''free'' then 2' in lower(function_body)) = 0
     or position('when ''standard'' then 10' in lower(function_body)) = 0
     or position('when ''premium'' then 30' in lower(function_body)) = 0 then
    raise exception 'Novel plan limits are not Free/Standard/Premium = 2/10/30';
  end if;

  if position('when ''free'' then 1' in lower(function_body)) > 0 then
    raise exception 'Legacy Free one-novel limit remains in the active function';
  end if;

  select count(*)
  into trigger_count
  from pg_trigger
  where not tgisinternal
    and tgrelid = 'public.novels'::regclass
    and tgname = 'novelight_enforce_novel_plan_limit';

  if trigger_count <> 1 then
    raise exception 'Expected exactly one novel plan-limit trigger, found %', trigger_count;
  end if;
end
$$;

select 'PASS: Free novel limit is 2 and paid-plan limits remain unchanged' as result;