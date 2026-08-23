-- NOVELIGHT beta exposure allocation postcheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_exposure_rules') is null then
    raise exception 'public.novel_exposure_rules was not created';
  end if;

  if to_regclass('public.novel_exposure_events') is null then
    raise exception 'public.novel_exposure_events was not created';
  end if;

  if has_table_privilege('anon', 'public.novel_exposure_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_exposure_events', 'SELECT')
     or has_table_privilege('anon', 'public.novel_exposure_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_exposure_events', 'INSERT') then
    raise exception 'Exposure ledger must not be directly exposed';
  end if;

  if has_table_privilege('anon', 'public.novel_exposure_rules', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_exposure_rules', 'SELECT') then
    raise exception 'Exposure rules must not be directly exposed';
  end if;

  if to_regprocedure('public.novelight_discovery_feed(text,integer,text,text,text)') is null then
    raise exception 'public.novelight_discovery_feed is missing';
  end if;

  if to_regprocedure('public.record_novel_impressions(text,text[],text)') is null then
    raise exception 'public.record_novel_impressions is missing';
  end if;

  if not has_function_privilege('anon', 'public.novelight_discovery_feed(text,integer,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_discovery_feed(text,integer,text,text,text)', 'EXECUTE') then
    raise exception 'Discovery feed must be executable by anon and authenticated';
  end if;

  if not has_function_privilege('anon', 'public.record_novel_impressions(text,text[],text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_novel_impressions(text,text[],text)', 'EXECUTE') then
    raise exception 'Impression recorder must be executable by anon and authenticated';
  end if;

  if not exists (
    select 1
    from public.novel_exposure_rules
    where id = 1
      and rule_version = 'beta-v1'
      and free_weight = 1.000
      and standard_weight = 1.350
      and premium_weight = 1.600
      and premium_new_work_boost = 1.200
      and premium_new_work_hours = 48
      and viewer_repeat_hours = 6
  ) then
    raise exception 'Expected beta-v1 exposure rule row is missing';
  end if;
end
$$;

select 'PASS: exposure allocation postcheck' as result;
