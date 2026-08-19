-- NovelRise rollback for migration 20260819190000.
-- Run only if the matching migration committed successfully and rollback is needed.
-- It restores backed-up SELECT policies, the prior RLS enabled flags, and the prior
-- episodes -> novels FK. It removes UNIQUE constraints only if the migration added them.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260819190000'));

do $$
begin
  if not exists (
    select 1
    from novelrise_migration_backup.migration_state
    where migration_id = '20260819190000'
  ) then
    raise exception 'Rollback backup for migration 20260819190000 was not found';
  end if;
end
$$;

drop policy if exists novelrise_novels_select_published_or_owner
on public.novels;

drop policy if exists novelrise_episodes_select_published_or_novel_owner
on public.episodes;

-- Restore every SELECT policy captured before migration.
do $$
declare
  p record;
  role_list text;
  sql_text text;
begin
  for p in
    select *
    from novelrise_migration_backup.select_policies
    where migration_id = '20260819190000'
    order by tablename, policyname
  loop
    select string_agg(quote_ident(role_name::text), ', ')
    into role_list
    from unnest(p.roles) as role_name;

    sql_text := format(
      'create policy %I on %I.%I as %s for select to %s',
      p.policyname,
      p.schemaname,
      p.tablename,
      p.permissive,
      role_list
    );

    if p.qual is not null then
      sql_text := sql_text || format(' using (%s)', p.qual);
    end if;

    execute sql_text;
  end loop;
end
$$;

-- Restore RLS enabled/disabled state as it existed before migration.
do $$
declare
  s record;
begin
  select * into s
  from novelrise_migration_backup.migration_state
  where migration_id = '20260819190000';

  if s.novels_rls_was_enabled then
    alter table public.novels enable row level security;
  else
    alter table public.novels disable row level security;
  end if;

  if s.episodes_rls_was_enabled then
    alter table public.episodes enable row level security;
  else
    alter table public.episodes disable row level security;
  end if;
end
$$;

-- Restore the original episodes -> novels FK only if migration changed it.
do $$
declare
  s record;
  current_fk record;
  episode_novel_attnum smallint;
  novel_id_attnum smallint;
begin
  select * into s
  from novelrise_migration_backup.migration_state
  where migration_id = '20260819190000';

  if s.episode_fk_changed then
    select attnum into episode_novel_attnum
    from pg_attribute
    where attrelid = 'public.episodes'::regclass
      and attname = 'novel_id'
      and not attisdropped;

    select attnum into novel_id_attnum
    from pg_attribute
    where attrelid = 'public.novels'::regclass
      and attname = 'id'
      and not attisdropped;

    for current_fk in
      select c.conname
      from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = 'public.episodes'::regclass
        and c.confrelid = 'public.novels'::regclass
        and c.conkey = array[episode_novel_attnum]::smallint[]
        and c.confkey = array[novel_id_attnum]::smallint[]
    loop
      execute format(
        'alter table public.episodes drop constraint %I',
        current_fk.conname
      );
    end loop;

    if s.original_episode_fk_name is not null then
      execute format(
        'alter table public.episodes add constraint %I %s',
        s.original_episode_fk_name,
        s.original_episode_fk_definition
      );
    end if;
  end if;
end
$$;

-- Remove only constraints that did not exist before this migration.
do $$
declare
  s record;
begin
  select * into s
  from novelrise_migration_backup.migration_state
  where migration_id = '20260819190000';

  if s.favorites_unique_created then
    alter table public.favorites
      drop constraint if exists favorites_user_id_novel_id_key;
  end if;

  if s.episode_number_unique_created then
    alter table public.episodes
      drop constraint if exists episodes_novel_id_episode_number_key;
  end if;
end
$$;

-- Retain backup rows as an audit trail. Delete them manually only after the
-- rollback and application behavior have both been verified.

commit;
