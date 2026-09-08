\set ON_ERROR_STOP on

-- Fail closed if the entitlement RPC or its dependencies are not the expected
-- pre-repair schema. This check is read-only.
do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.novelight_author_exposure_funnel_v2(integer)') is null then
    raise exception 'LIGHT ANALYTICS v2 RPC is missing';
  end if;

  if to_regprocedure('public.novelight_author_exposure_funnel(integer)') is null then
    raise exception 'LIGHT ANALYTICS compatibility RPC is missing';
  end if;

  if to_regclass('public.profiles') is null
     or to_regclass('public.novel_exposure_events') is null
     or to_regclass('public.novel_exposure_conversions') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null then
    raise exception 'LIGHT ANALYTICS runtime dependencies are incomplete';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'plan'
  ) then
    raise exception 'profiles.plan is required for LIGHT ANALYTICS entitlements';
  end if;

  select pg_get_functiondef('public.novelight_author_exposure_funnel_v2(integer)'::regprocedure)
    into v_definition;

  if position('where v_plan in (''standard'', ''premium'')' in lower(v_definition)) = 0
     or position('having v_plan = ''free''' in lower(v_definition)) = 0 then
    raise exception 'LIGHT ANALYTICS entitlement boundaries are not in the expected state';
  end if;
end
$$;
