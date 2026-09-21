\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.scout_record_usage_days') is null
     or to_regclass('public.scout_point_user_controls') is null
     or to_regclass('public.scout_point_operator_actions') is null then
    raise exception 'SCOUT usage/control tables are incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'scout_record_usage_days',
        'scout_point_user_controls',
        'scout_point_operator_actions'
      )
      and c.relrowsecurity
    group by n.nspname
    having count(*) = 3
  ) then
    raise exception 'SCOUT usage/control tables must all have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.scout_record_usage_days', 'select')
     or has_table_privilege('authenticated', 'public.scout_record_usage_days', 'select')
     or has_table_privilege('authenticated', 'public.scout_point_user_controls', 'select')
     or has_table_privilege('authenticated', 'public.scout_point_operator_actions', 'select') then
    raise exception 'SCOUT usage/control raw tables must remain private';
  end if;

  if to_regprocedure('public.novelight_record_scout_record_visit()') is null
     or to_regprocedure('public.novelight_scout_point_earning_allowed(uuid)') is null
     or to_regprocedure('public.novelight_enforce_scout_point_control()') is null
     or to_regprocedure('public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)') is null then
    raise exception 'SCOUT usage/control functions are incomplete';
  end if;

  if has_function_privilege('anon', 'public.novelight_record_scout_record_visit()', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_record_scout_record_visit()', 'execute') then
    raise exception 'SCOUT usage RPC grants are incorrect';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)',
       'execute'
     ) then
    raise exception 'SCOUT operator RPC must be service-role only';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'scout_point_earning_control'
      and not tgisinternal
  ) then
    raise exception 'Central Scout Point earning control trigger is missing';
  end if;

  if pg_catalog.strpos(
    pg_get_functiondef('public.novelight_enforce_scout_point_control()'::regprocedure),
    'return null'
  ) = 0 then
    raise exception 'Point earning suspension must block positive automatic inserts';
  end if;

  if pg_catalog.strpos(
    pg_get_functiondef(
      'public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)'::regprocedure
    ),
    '''reversal'''
  ) = 0 or pg_catalog.strpos(
    pg_get_functiondef(
      'public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)'::regprocedure
    ),
    '''manual_adjustment'''
  ) = 0 then
    raise exception 'Point cancellation/adjustment audit paths are missing';
  end if;
end
$$;
