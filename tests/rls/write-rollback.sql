\set ON_ERROR_STOP on

select public.test_assert(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and policyname in (
        'novelrise_novels_insert_owner',
        'novelrise_novels_update_owner',
        'novelrise_novels_delete_owner',
        'novelrise_episodes_insert_owner',
        'novelrise_episodes_update_owner',
        'novelrise_episodes_delete_owner'
      )
  ),
  'managed write policies must be removed by rollback'
);

select public.test_assert(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'fixture must return to its original no-write-policy baseline'
);

select public.test_assert(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'novels'
      and policyname = 'novelrise_novels_select_published_or_owner'
      and cmd = 'SELECT'
  ),
  'novels SELECT policy must survive write-policy rollback'
);

select public.test_assert(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_select_published_or_novel_owner'
      and cmd = 'SELECT'
  ),
  'episodes SELECT policy must survive write-policy rollback'
);

select 'PASS: write RLS rollback restores the prior policy baseline' as result;
