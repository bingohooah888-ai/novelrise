select
  to_regclass('public.profiles') is not null as profiles_exists,
  to_regclass('public.novels') is not null as novels_exists,
  to_regclass('public.episodes') is not null as episodes_exists,
  to_regclass('public.favorites') is not null as favorites_exists,
  (
    to_regclass('public.profiles') is not null
    and to_regclass('public.novels') is not null
    and to_regclass('public.episodes') is not null
    and to_regclass('public.favorites') is not null
  ) as ok;
