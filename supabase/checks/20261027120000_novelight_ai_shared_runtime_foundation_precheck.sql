-- Read-only Staging/Production precheck for NOVELIGHT AI shared runtime.
-- Expected: no AI schema exists; canonical works/auth tables already exist.
-- This does not change any database state.
do $ai_precheck$
declare
  v_name text;
begin
  if pg_catalog.to_regclass('public.novels') is null
    or pg_catalog.to_regclass('public.episodes') is null
    or pg_catalog.to_regclass('auth.users') is null then
    raise exception 'AI staging precheck blocked: existing work/auth tables missing';
  end if;

  foreach v_name in array array[
    'novelight_ai_runtime_settings',
    'novelight_ai_usage_requests',
    'novelight_ai_usage_audit',
    'novelight_ai_bible_facts',
    'novelight_ai_episode_analysis'
  ] loop
    if pg_catalog.to_regclass('public.' || v_name) is not null then
      raise exception 'AI staging precheck blocked: table % already exists', v_name;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.novelight_ai_reserve_usage(uuid,text,bigint,bigint,text)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_settle_usage(uuid,bigint)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_fact_source_guard()') is not null then
    raise exception 'AI staging precheck blocked: AI runtime RPC/trigger already exists';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    raise exception 'AI staging precheck blocked: Supabase roles missing';
  end if;
end;
$ai_precheck$;
