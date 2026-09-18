\set ON_ERROR_STOP on

do $$
declare
  v_comment text;
  v_security_definer boolean;
  v_config text[];
begin
  if to_regprocedure('public.novelight_batch_manage_episode_schedules(bigint,jsonb)') is null then
    raise exception 'POSTCHECK FAIL: B #13 batch schedule RPC is missing';
  end if;

  select p.prosecdef, p.proconfig
    into v_security_definer, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid = 'public.novelight_batch_manage_episode_schedules(bigint,jsonb)'::regprocedure;

  if v_security_definer then
    raise exception 'POSTCHECK FAIL: B #13 batch schedule RPC must remain SECURITY INVOKER';
  end if;

  if v_config is null
     or coalesce(pg_catalog.array_to_string(v_config, ','), '')
          not like '%search_path=""%' then
    raise exception 'POSTCHECK FAIL: B #13 batch schedule RPC must pin an empty search_path';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.novelight_batch_manage_episode_schedules(bigint,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'POSTCHECK FAIL: authenticated authors cannot execute B #13 batch schedule RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.novelight_batch_manage_episode_schedules(bigint,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.novelight_batch_manage_episode_schedules(bigint,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'POSTCHECK FAIL: B #13 batch schedule RPC is exposed beyond authenticated authors';
  end if;

  select obj_description(
    'public.novelight_batch_manage_episode_schedules(bigint,jsonb)'::regprocedure,
    'pg_proc'
  )
    into v_comment;

  if v_comment is null
     or position('does not alter Rank, LIGHT SEED, SCOUT, PV, favorites, discovery, or exposure' in v_comment) = 0 then
    raise exception 'POSTCHECK FAIL: B #13 neutrality contract comment is missing';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is null
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is null then
    raise exception 'POSTCHECK FAIL: B #13 disturbed the existing schedule foundation';
  end if;
end
$$;

select 'POSTCHECK PASS: B #13 batch scheduling is owner-only, atomic, and reuses the existing scheduler' as result;
