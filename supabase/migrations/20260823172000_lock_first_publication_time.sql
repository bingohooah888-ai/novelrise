-- NOVELIGHT: make first publication time authoritative and non-resettable.
-- Draft creation time must not consume/age-out the initial exposure window, and
-- authors must not be able to reset new-work boosts by toggling draft/published.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823172000'));

alter table public.novels
  add column first_published_at timestamptz;

-- Existing published works predate the draft-first publishing flow, so their
-- existing created_at is the best available publication timestamp.
update public.novels
set first_published_at = created_at
where status = 'published'
  and first_published_at is null;

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public;
revoke all on schema novelrise_migration_backup from anon, authenticated;

create table if not exists novelrise_migration_backup.publication_created_at (
  migration_id text not null,
  novel_id text not null,
  original_created_at timestamptz not null,
  backed_up_at timestamptz not null default now(),
  primary key (migration_id, novel_id)
);

create or replace function public.lock_first_publication_time()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
begin
  if tg_op = 'INSERT' then
    -- Direct published inserts (fixtures/admin flows) already use insertion time
    -- as publication time. Client-provided first_published_at is not trusted.
    if new.status = 'published' then
      new.first_published_at := coalesce(new.created_at, v_now);
      new.created_at := new.first_published_at;
    else
      new.first_published_at := null;
    end if;
    return new;
  end if;

  -- created_at and first_published_at are server-authoritative after INSERT.
  new.created_at := old.created_at;
  new.first_published_at := old.first_published_at;

  if old.first_published_at is null and new.status = 'published' then
    insert into novelrise_migration_backup.publication_created_at (
      migration_id,
      novel_id,
      original_created_at
    ) values (
      '20260823172000',
      old.id::text,
      old.created_at
    )
    on conflict (migration_id, novel_id) do nothing;

    new.first_published_at := v_now;
    -- Existing code, ranking, Premium 48h boost and discovery use created_at as
    -- the public release timestamp. Move it exactly once at first publication.
    new.created_at := v_now;
  end if;

  return new;
end
$$;

create trigger novels_lock_first_publication_time
before insert or update
on public.novels
for each row
execute function public.lock_first_publication_time();

commit;
