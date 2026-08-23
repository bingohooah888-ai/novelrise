\set ON_ERROR_STOP on

select public.test_assert(to_regclass('public.novels') is not null, 'novels must exist');
select public.test_assert(to_regclass('public.episodes') is not null, 'episodes must exist');
select public.test_assert(to_regclass('public.favorites') is not null, 'favorites must exist');
select public.test_assert(to_regclass('public.light_seeds') is not null, 'LIGHT SEED must be deployed first');
select public.test_assert(to_regclass('public.content_reports') is null, 'beta foundations must not already exist');
