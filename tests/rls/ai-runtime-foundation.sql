-- Disposable PostgreSQL replay only. Never run against Production.
begin;

do $precheck$
declare
  v_table text;
begin
  foreach v_table in array array[
    'novelight_ai_runtime_settings', 'novelight_ai_usage_requests',
    'novelight_ai_usage_audit', 'novelight_ai_bible_facts',
    'novelight_ai_episode_analysis'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'AI runtime table missing: %', v_table;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'AI runtime table lacks RLS: %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
    then
      raise exception 'AI runtime table leaked to client role: %', v_table;
    end if;
  end loop;

  if has_function_privilege('anon',
       'public.novelight_ai_reserve_usage(uuid,text,bigint,bigint,text)', 'EXECUTE')
    or has_function_privilege('authenticated',
       'public.novelight_ai_reserve_usage(uuid,text,bigint,bigint,text)', 'EXECUTE')
    or has_function_privilege('anon',
       'public.novelight_ai_settle_usage(uuid,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated',
       'public.novelight_ai_settle_usage(uuid,bigint)', 'EXECUTE')
  then
    raise exception 'AI service-only RPC is executable by browser role';
  end if;

  if (select enabled from public.novelight_ai_runtime_settings where singleton=1) is not false then
    raise exception 'AI runtime unexpectedly enabled';
  end if;
end
$precheck$;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'ai-test-1@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'ai-test-2@example.invalid')
on conflict (id) do nothing;

set local role service_role;

do $budget$
declare
  v_first uuid;
  v_second uuid;
  v_third uuid;
begin
  -- Disabled even with valid owner and small request.
  if public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 10, repeat('a',64)) is not null
  then raise exception 'AI kill switch allowed a request'; end if;

  update public.novelight_ai_runtime_settings
    set enabled=true, user_day_cap_micros=100, user_month_cap_micros=120,
        global_day_cap_micros=100, global_month_cap_micros=150
    where singleton=1;

  v_first := public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 60, repeat('a',64));
  if v_first is null then raise exception 'AI first reserve failed'; end if;
  if public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 60, repeat('a',64)) is not null
  then raise exception 'Duplicate AI request admitted'; end if;
  if public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 50, repeat('b',64)) is not null
  then raise exception 'Exceeded pending user cap'; end if;

  if not public.novelight_ai_settle_usage(v_first,10) then
    raise exception 'AI settlement failed';
  end if;
  if not public.novelight_ai_settle_usage(v_first,10) then
    raise exception 'Idempotent settlement failed';
  end if;
  if public.novelight_ai_settle_usage(v_first,20) then
    raise exception 'Conflicting settlement succeeded';
  end if;

  v_second := public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 50, repeat('b',64));
  if v_second is null then raise exception 'AI refund not reflected'; end if;
  if public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 45, repeat('c',64)) is not null
  then raise exception 'Pending AI reservation was not counted'; end if;
  perform public.novelight_ai_settle_usage(v_second,40);

  v_third := public.novelight_ai_reserve_usage(
    '11111111-1111-4111-8111-111111111111', 'prepublish-check',
    null, 45, repeat('c',64));
  if v_third is null then raise exception 'AI cap released after settlement failed'; end if;

  if public.novelight_ai_reserve_usage(
    '22222222-2222-4222-8222-222222222222', 'prepublish-check',
    null, 10, repeat('d',64)) is not null
  then raise exception 'Global day cap ignored';
  end if;

  -- A denied fallback cannot launch a provider call.
  update public.novelight_ai_runtime_settings set enabled=false where singleton=1;
  if public.novelight_ai_reserve_usage(
    '22222222-2222-4222-8222-222222222222', 'prepublish-check',
    null, 1, repeat('e',64)) is not null
  then raise exception 'AI kill switch ignored after disabling'; end if;
end
$budget$;

reset role;
rollback;
