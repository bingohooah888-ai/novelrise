\set ON_ERROR_STOP on

select public.test_assert(
  to_regclass('public.episode_pv_events') is null,
  'PV rollback must remove the audit table'
);
select public.test_assert(
  to_regprocedure('public.record_episode_pv(text,text)') is null,
  'PV rollback must remove the guarded RPC'
);
select public.test_assert(
  coalesce(
    has_function_privilege(
      'anon',
      to_regprocedure('public.increment_novel_pv(bigint)'),
      'EXECUTE'
    ),
    true
  ),
  'PV rollback must restore legacy novel RPC permission when that RPC exists'
);
select public.test_assert(
  coalesce(
    has_function_privilege(
      'anon',
      to_regprocedure('public.increment_episode_pv(bigint)'),
      'EXECUTE'
    ),
    true
  ),
  'PV rollback must restore legacy episode RPC permission when that RPC exists'
);

select 'PASS: authoritative PV counting rollback' as result;
