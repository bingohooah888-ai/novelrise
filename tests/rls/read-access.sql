\set ON_ERROR_STOP on

select public.test_assert(
  (select relrowsecurity from pg_class where oid = 'public.novels'::regclass),
  'novels RLS must be enabled'
);

select public.test_assert(
  (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass),
  'episodes RLS must be enabled'
);

select public.test_assert(
  (
    select count(*) = 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'novels'
      and policyname = 'novelrise_novels_select_published_or_owner'
      and cmd = 'SELECT'
  ),
  'novels must have exactly one intended SELECT policy'
);

select public.test_assert(
  (
    select count(*) = 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_select_published_or_novel_owner'
      and cmd = 'SELECT'
  ),
  'episodes must have exactly one intended SELECT policy'
);

select public.test_assert(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd = 'ALL'
  ),
  'novels/episodes must not have a FOR ALL policy in the integration fixture'
);

set role anon;

select public.test_assert(
  (select count(*) from public.novels) = 2,
  'anon must see only the two published novels'
);

select public.test_assert(
  not exists (
    select 1
    from public.novels
    where id in (
      '10000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000002'
    )
  ),
  'anon must not see draft novels'
);

select public.test_assert(
  (select count(*) from public.episodes) = 2,
  'anon must see only published episodes whose parent novel is published'
);

select public.test_assert(
  not exists (
    select 1
    from public.episodes
    where id in (
      '11000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000003',
      '22000000-0000-0000-0000-000000000002',
      '22000000-0000-0000-0000-000000000003'
    )
  ),
  'anon must not see draft episodes or episodes under draft novels'
);

reset role;
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);

select public.test_assert(
  (select count(*) from public.novels) = 3,
  'author A must see both own novels plus author B published novel'
);

select public.test_assert(
  exists (
    select 1
    from public.novels
    where id = '10000000-0000-0000-0000-000000000002'
  ),
  'author A must see own draft novel'
);

select public.test_assert(
  not exists (
    select 1
    from public.novels
    where id = '20000000-0000-0000-0000-000000000002'
  ),
  'author A must not see author B draft novel'
);

select public.test_assert(
  (select count(*) from public.episodes) = 4,
  'author A must see public episodes plus all episodes belonging to own novels'
);

select public.test_assert(
  exists (
    select 1
    from public.episodes
    where id in (
      '11000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000003'
    )
    group by true
    having count(*) = 2
  ),
  'author A must see own draft episode and own episode under a draft novel'
);

select public.test_assert(
  not exists (
    select 1
    from public.episodes
    where id in (
      '22000000-0000-0000-0000-000000000002',
      '22000000-0000-0000-0000-000000000003'
    )
  ),
  'author A must not see author B private episodes'
);

reset role;
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);

select public.test_assert(
  (select count(*) from public.novels) = 3,
  'author B must see both own novels plus author A published novel'
);

select public.test_assert(
  exists (
    select 1
    from public.novels
    where id = '20000000-0000-0000-0000-000000000002'
  ),
  'author B must see own draft novel'
);

select public.test_assert(
  not exists (
    select 1
    from public.novels
    where id = '10000000-0000-0000-0000-000000000002'
  ),
  'author B must not see author A draft novel'
);

select public.test_assert(
  (select count(*) from public.episodes) = 4,
  'author B must see public episodes plus all episodes belonging to own novels'
);

select public.test_assert(
  not exists (
    select 1
    from public.episodes
    where id in (
      '11000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000003'
    )
  ),
  'author B must not see author A private episodes'
);

reset role;
