begin;

select pg_advisory_xact_lock(hashtext('novelight:20260828223000'));

revoke all on function public.novelight_public_profile(uuid) from public, anon, authenticated;
revoke all on function public.novelight_favorite_count(text) from public, anon, authenticated;
revoke all on function public.novelight_neutral_search(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.novelight_ranking_feed(text, integer) from public, anon, authenticated;

drop function if exists public.novelight_public_profile(uuid);
drop function if exists public.novelight_favorite_count(text);
drop function if exists public.novelight_neutral_search(text, text, text, integer, integer);
drop function if exists public.novelight_ranking_feed(text, integer);

drop policy if exists novelight_profiles_select_own on public.profiles;
drop policy if exists novelight_favorites_select_own on public.favorites;

revoke select on table public.profiles from anon, authenticated;
revoke select on table public.favorites from anon, authenticated;

do $$
declare
  p record;
  role_list text;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, qual
    from novelrise_migration_backup.select_policies
    where migration_id = '20260828223000'
    order by schemaname, tablename, policyname
  loop
    select string_agg(quote_ident(r::text), ', ')
      into role_list
      from unnest(p.roles) as r;

    execute format(
      'create policy %I on %I.%I as %s for select to %s using (%s)',
      p.policyname,
      p.schemaname,
      p.tablename,
      p.permissive,
      coalesce(role_list, 'public'),
      coalesce(p.qual, 'true')
    );
  end loop;
end
$$;

do $$
declare
  g record;
begin
  for g in
    select table_name, role_name, had_select
    from novelrise_migration_backup.table_select_grants
    where migration_id = '20260828223000'
  loop
    if g.had_select then
      execute format('grant select on table public.%I to %I', g.table_name, g.role_name);
    else
      execute format('revoke select on table public.%I from %I', g.table_name, g.role_name);
    end if;
  end loop;
end
$$;

do $$
declare
  s record;
begin
  for s in
    select table_name, was_enabled, was_forced
    from novelrise_migration_backup.table_rls_state
    where migration_id = '20260828223000'
    order by table_name
  loop
    if s.was_enabled then
      execute format('alter table public.%I enable row level security', s.table_name);
    else
      execute format('alter table public.%I disable row level security', s.table_name);
    end if;

    if s.was_forced then
      execute format('alter table public.%I force row level security', s.table_name);
    else
      execute format('alter table public.%I no force row level security', s.table_name);
    end if;
  end loop;
end
$$;

delete from novelrise_migration_backup.select_policies
where migration_id = '20260828223000';

delete from novelrise_migration_backup.table_select_grants
where migration_id = '20260828223000';

delete from novelrise_migration_backup.table_rls_state
where migration_id = '20260828223000';

commit;
