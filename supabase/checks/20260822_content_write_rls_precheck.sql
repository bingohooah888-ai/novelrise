-- NOVELIGHT: precheck before managing novels/episodes write RLS.
-- Read-only. Abort on an unsafe or unexpected baseline.

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'Required tables public.novels and public.episodes must exist';
  end if;

  if not coalesce(
    (select relrowsecurity from pg_class where oid = 'public.novels'::regclass),
    false
  ) then
    raise exception 'RLS must already be enabled on public.novels';
  end if;

  if not coalesce(
    (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass),
    false
  ) then
    raise exception 'RLS must already be enabled on public.episodes';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'novels'
      and policyname = 'novelrise_novels_select_published_or_owner'
      and cmd = 'SELECT'
  ) <> 1 then
    raise exception 'Expected novels SELECT policy is missing or duplicated';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_select_published_or_novel_owner'
      and cmd = 'SELECT'
  ) <> 1 then
    raise exception 'Expected episodes SELECT policy is missing or duplicated';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd = 'ALL'
  ) then
    raise exception 'A FOR ALL policy exists on novels or episodes. Review it manually before managing write policies.';
  end if;

  if exists (
    select 1
    from public.episodes e
    join public.novels n on n.id = e.novel_id
    where e.user_id is distinct from n.user_id
  ) then
    raise exception 'Episode user_id differs from the owning novel user_id';
  end if;

  if to_regclass('novelrise_migration_backup.write_migration_state') is not null
     and exists (
       select 1
       from novelrise_migration_backup.write_migration_state
       where migration_id = '20260822194000'
     ) then
    raise exception 'Write RLS migration 20260822194000 already has backup state';
  end if;

  if exists (
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
  ) then
    raise exception 'Managed write policy names already exist';
  end if;
end
$$;

select 'PASS: write RLS baseline is safe for migration' as result;
