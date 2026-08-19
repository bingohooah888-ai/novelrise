-- NovelRise: secure novel/episode reads and relational integrity.
--
-- IMPORTANT:
--   1. Run the matching precheck first.
--   2. This migration aborts on duplicate keys, ownership inconsistencies,
--      orphan episodes, or an existing FOR ALL policy on novels/episodes.
--   3. Existing SELECT policies and the episodes -> novels FK are backed up
--      in novelrise_migration_backup so the matching rollback can restore them.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260819190000'));

create schema if not exists novelrise_migration_backup;

revoke all on schema novelrise_migration_backup from public;
revoke all on schema novelrise_migration_backup from anon, authenticated;

create table if not exists novelrise_migration_backup.migration_state (
  migration_id text primary key,
  applied_at timestamptz not null default now(),
  novels_rls_was_enabled boolean not null,
  episodes_rls_was_enabled boolean not null,
  original_episode_fk_name text,
  original_episode_fk_definition text,
  episode_fk_changed boolean not null default false,
  favorites_unique_created boolean not null default false,
  episode_number_unique_created boolean not null default false
);

create table if not exists novelrise_migration_backup.select_policies (
  migration_id text not null,
  schemaname name not null,
  tablename name not null,
  policyname name not null,
  permissive text not null,
  roles name[] not null,
  cmd text not null,
  qual text,
  with_check text,
  primary key (migration_id, schemaname, tablename, policyname)
);

do $$
begin
  if exists (
    select 1
    from novelrise_migration_backup.migration_state
    where migration_id = '20260819190000'
  ) then
    raise exception 'Migration 20260819190000 has already been applied or has an existing backup. Stop and inspect novelrise_migration_backup.';
  end if;

  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null then
    raise exception 'Required tables public.novels, public.episodes, and public.favorites must exist';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd = 'ALL'
  ) then
    raise exception 'A FOR ALL policy exists on novels or episodes. Split/review it manually before applying this migration.';
  end if;

  if exists (
    select 1
    from public.favorites
    group by user_id, novel_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate favorites(user_id, novel_id) rows exist';
  end if;

  if exists (
    select 1
    from public.episodes
    group by novel_id, episode_number
    having count(*) > 1
  ) then
    raise exception 'Duplicate episodes(novel_id, episode_number) rows exist';
  end if;

  if exists (
    select 1
    from public.episodes e
    left join public.novels n on n.id = e.novel_id
    where n.id is null
  ) then
    raise exception 'Orphan episode rows exist';
  end if;

  if exists (
    select 1
    from public.episodes e
    join public.novels n on n.id = e.novel_id
    where e.user_id is distinct from n.user_id
  ) then
    raise exception 'Episode user_id differs from the owning novel user_id';
  end if;

  if exists (
    select 1 from public.novels
    where user_id is null
       or status is null
       or status not in ('published', 'draft')
  ) then
    raise exception 'novels contains null/unsupported ownership or status values';
  end if;

  if exists (
    select 1 from public.episodes
    where novel_id is null
       or user_id is null
       or episode_number is null
       or status is null
       or status not in ('published', 'draft')
  ) then
    raise exception 'episodes contains null/unsupported key, ownership, or status values';
  end if;
end
$$;

insert into novelrise_migration_backup.migration_state (
  migration_id,
  novels_rls_was_enabled,
  episodes_rls_was_enabled
)
select
  '20260819190000',
  (select relrowsecurity from pg_class where oid = 'public.novels'::regclass),
  (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass);

insert into novelrise_migration_backup.select_policies (
  migration_id,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
)
select
  '20260819190000',
  schemaname,
  tablename,
  policyname,
  permissive,
  roles::name[],
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('novels', 'episodes')
  and cmd = 'SELECT';

-- Drop only SELECT policies. INSERT/UPDATE/DELETE policies remain untouched.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('novels', 'episodes')
      and cmd = 'SELECT'
  loop
    execute format(
      'drop policy %I on %I.%I',
      p.policyname,
      p.schemaname,
      p.tablename
    );
  end loop;
end
$$;

alter table public.novels enable row level security;
alter table public.episodes enable row level security;

create policy novelrise_novels_select_published_or_owner
on public.novels
as permissive
for select
to anon, authenticated
using (
  status = 'published'
  or (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  )
);

create policy novelrise_episodes_select_published_or_novel_owner
on public.episodes
as permissive
for select
to anon, authenticated
using (
  (
    status = 'published'
    and exists (
      select 1
      from public.novels n
      where n.id = episodes.novel_id
        and n.status = 'published'
    )
  )
  or (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.novels n
      where n.id = episodes.novel_id
        and n.user_id = (select auth.uid())
    )
  )
);

-- Add UNIQUE constraints only when an equivalent constraint does not exist.
do $$
declare
  favorites_user_attnum smallint;
  favorites_novel_attnum smallint;
  episodes_novel_attnum smallint;
  episodes_number_attnum smallint;
begin
  select attnum into favorites_user_attnum
  from pg_attribute
  where attrelid = 'public.favorites'::regclass
    and attname = 'user_id'
    and not attisdropped;

  select attnum into favorites_novel_attnum
  from pg_attribute
  where attrelid = 'public.favorites'::regclass
    and attname = 'novel_id'
    and not attisdropped;

  select attnum into episodes_novel_attnum
  from pg_attribute
  where attrelid = 'public.episodes'::regclass
    and attname = 'novel_id'
    and not attisdropped;

  select attnum into episodes_number_attnum
  from pg_attribute
  where attrelid = 'public.episodes'::regclass
    and attname = 'episode_number'
    and not attisdropped;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.favorites'::regclass
      and contype = 'u'
      and cardinality(conkey) = 2
      and conkey @> array[favorites_user_attnum, favorites_novel_attnum]::smallint[]
  ) then
    alter table public.favorites
      add constraint favorites_user_id_novel_id_key
      unique (user_id, novel_id);

    update novelrise_migration_backup.migration_state
    set favorites_unique_created = true
    where migration_id = '20260819190000';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.episodes'::regclass
      and contype = 'u'
      and cardinality(conkey) = 2
      and conkey @> array[episodes_novel_attnum, episodes_number_attnum]::smallint[]
  ) then
    alter table public.episodes
      add constraint episodes_novel_id_episode_number_key
      unique (novel_id, episode_number);

    update novelrise_migration_backup.migration_state
    set episode_number_unique_created = true
    where migration_id = '20260819190000';
  end if;
end
$$;

-- Replace the single-column episodes(novel_id) -> novels(id) FK with CASCADE.
-- An existing composite or multiple matching FK arrangement aborts for review.
do $$
declare
  episode_novel_attnum smallint;
  novel_id_attnum smallint;
  fk_count integer;
  existing_fk record;
begin
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

  select count(*) into fk_count
  from pg_constraint
  where conrelid = 'public.episodes'::regclass
    and confrelid = 'public.novels'::regclass
    and contype = 'f'
    and conkey = array[episode_novel_attnum]::smallint[]
    and confkey = array[novel_id_attnum]::smallint[];

  if fk_count > 1 then
    raise exception 'Multiple episodes(novel_id) -> novels(id) foreign keys exist';
  end if;

  select
    conname,
    confdeltype,
    pg_get_constraintdef(oid, true) as definition
  into existing_fk
  from pg_constraint
  where conrelid = 'public.episodes'::regclass
    and confrelid = 'public.novels'::regclass
    and contype = 'f'
    and conkey = array[episode_novel_attnum]::smallint[]
    and confkey = array[novel_id_attnum]::smallint[];

  if existing_fk.conname is null then
    alter table public.episodes
      add constraint episodes_novel_id_fkey
      foreign key (novel_id)
      references public.novels(id)
      on delete cascade;

    update novelrise_migration_backup.migration_state
    set episode_fk_changed = true
    where migration_id = '20260819190000';

  elsif existing_fk.confdeltype <> 'c' then
    update novelrise_migration_backup.migration_state
    set
      original_episode_fk_name = existing_fk.conname,
      original_episode_fk_definition = existing_fk.definition,
      episode_fk_changed = true
    where migration_id = '20260819190000';

    execute format(
      'alter table public.episodes drop constraint %I',
      existing_fk.conname
    );

    alter table public.episodes
      add constraint episodes_novel_id_fkey
      foreign key (novel_id)
      references public.novels(id)
      on delete cascade;
  end if;
end
$$;

commit;
