\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_lifecycle') is null then
    raise exception 'SCOUT core, badge foundation, and beta lifecycle are required';
  end if;

  if to_regclass('public.scout_record_usage_days') is not null
     or to_regclass('public.scout_point_user_controls') is not null
     or to_regclass('public.scout_point_operator_actions') is not null then
    raise exception 'SCOUT usage/control foundation already exists or requires reconciliation';
  end if;

  if to_regprocedure('public.novelight_record_scout_record_visit()') is not null
     or to_regprocedure('public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)') is not null then
    raise exception 'SCOUT usage/control RPC already exists or requires reconciliation';
  end if;
end
$$;
