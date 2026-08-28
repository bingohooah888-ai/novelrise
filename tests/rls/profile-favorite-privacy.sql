\set ON_ERROR_STOP on

select public.test_assert(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon must not have direct profile table reads'
);

select public.test_assert(
  not has_table_privilege('anon', 'public.favorites', 'SELECT'),
  'anon must not have direct favorite table reads'
);

select public.test_assert(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated users must retain own-profile reads'
);

select public.test_assert(
  has_table_privilege('authenticated', 'public.favorites', 'SELECT'),
  'authenticated users must retain own-favorite reads'
);

set role anon;

select public.test_assert(
  (
    select count(*)
    from public.novelight_public_profile(
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  ) = 1,
  'anon must be able to read the narrow public profile RPC for a published author'
);

select public.test_assert(
  public.novelight_favorite_count(
    '20000000-0000-0000-0000-000000000001'
  ) >= 1,
  'public favorite count RPC must expose only an aggregate count'
);

select public.test_assert(
  (
    select count(*)
    from public.novelight_neutral_search(
      'Free discovery work',
      null,
      'new',
      24,
      0
    )
  ) = 1,
  'neutral search RPC must return the matching published work without raw favorite rows'
);

select public.test_assert(
  (
    select count(*)
    from public.novelight_ranking_feed('total', 100)
  ) > 0,
  'ranking RPC must return published works'
);

reset role;
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);

select public.test_assert(
  (
    select count(*)
    from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'::uuid
  ) = 1,
  'authenticated user must read own profile'
);

select public.test_assert(
  not exists (
    select 1
    from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'::uuid
  ),
  'authenticated user must not read another user profile row directly'
);

select public.test_assert(
  not exists (
    select 1
    from public.favorites
    where user_id <> '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'authenticated user must not read another user favorite rows'
);

reset role;
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);

select public.test_assert(
  not exists (
    select 1
    from public.favorites
    where user_id = '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'another authenticated user must not infer reader A favorites from raw rows'
);

reset role;
