\set ON_ERROR_STOP on

select public.test_assert(
  to_regclass('public.light_seeds') is null,
  'light_seeds table must be removed by rollback'
);

select public.test_assert(
  to_regclass('public.light_seed_rules') is null,
  'light_seed_rules table must be removed by rollback'
);

select public.test_assert(
  to_regprocedure('public.light_seed_status(uuid)') is null,
  'light_seed_status function must be removed by rollback'
);

select public.test_assert(
  to_regprocedure('public.plant_light_seed(uuid)') is null,
  'plant_light_seed function must be removed by rollback'
);

select 'PASS: LIGHT SEED rollback' as result;
