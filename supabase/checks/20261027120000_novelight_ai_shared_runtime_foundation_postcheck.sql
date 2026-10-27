-- Read-only postcheck: AI schema must remain disabled, private and empty.
-- No AI API, tokens, billing or feature is activated by this check.
do $ai_postcheck$
declare
  v_name text;
  v_count bigint;
  v_rls boolean;
begin
  foreach v_name in array array[
    'novelight_ai_runtime_settings',
    'novelight_ai_usage_requests',
    'novelight_ai_usage_audit',
    'novelight_ai_bible_facts',
    'novelight_ai_episode_analysis'
  ] loop
    if pg_catalog.to_regclass('public.' || v_name) is null then
      raise exception 'AI postcheck failed: missing table %', v_name;
    end if;
    select c.relrowsecurity into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_name;
    if v_rls is distinct from true then
      raise exception 'AI postcheck failed: RLS not enabled on %', v_name;
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'DELETE')
    then
      raise exception 'AI postcheck failed: browser permission on %', v_name;
    end if;
    if not pg_catalog.has_table_privilege('service_role', 'public.' || v_name, 'SELECT') then
      raise exception 'AI postcheck failed: missing service_role read on %', v_name;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = v_name
        and policyname = 'ai_service_access'
        and roles = array['service_role']::name[]
    ) then
      raise exception 'AI postcheck failed: missing service-only RLS policy on %', v_name;
    end if;
  end loop;

  if (select count(*) from public.novelight_ai_runtime_settings) <> 1
    or not exists (
      select 1 from public.novelight_ai_runtime_settings
      where singleton=1 and enabled=false
        and user_day_cap_micros=0 and user_month_cap_micros=0
        and global_day_cap_micros=0 and global_month_cap_micros=0
    ) then
    raise exception 'AI postcheck failed: safe default-off zero-budget state missing';
  end if;

  if (select count(*) from public.novelight_ai_usage_requests) <> 0
    or (select count(*) from public.novelight_ai_usage_audit) <> 0
    or (select count(*) from public.novelight_ai_bible_facts) <> 0
    or (select count(*) from public.novelight_ai_episode_analysis) <> 0 then
    raise exception 'AI postcheck failed: initial runtime tables are not empty';
  end if;

  if pg_catalog.to_regprocedure('public.novelight_ai_reserve_usage(uuid,text,bigint,bigint,text)') is null
    or pg_catalog.to_regprocedure('public.novelight_ai_settle_usage(uuid,bigint)') is null
    or pg_catalog.to_regprocedure('public.novelight_ai_fact_source_guard()') is null then
    raise exception 'AI postcheck failed: required function missing';
  end if;

  if pg_catalog.has_function_privilege(
        'anon', 'public.novelight_ai_reserve_usage(uuid,text,bigint,bigint,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege(
        'authenticated', 'public.novelight_ai_reserve_usage(uuid,text,bigint,bigint,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege(
        'anon', 'public.novelight_ai_settle_usage(uuid,bigint)', 'EXECUTE')
    or pg_catalog.has_function_privilege(
        'authenticated', 'public.novelight_ai_settle_usage(uuid,bigint)', 'EXECUTE') then
    raise exception 'AI postcheck failed: public AI billing RPC execution privilege';
  end if;
end;
$ai_postcheck$;
