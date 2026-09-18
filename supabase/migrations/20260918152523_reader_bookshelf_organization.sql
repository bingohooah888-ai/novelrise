-- NOVELIGHT B #10: private reader bookshelf organization.
-- These rows are reader-only convenience data and never affect favorite counts,
-- Rank, LIGHT SEED, SCOUT, discovery, or exposure allocation.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918152523'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null then
    raise exception 'Reader bookshelf prerequisites are missing';
  end if;

  if to_regclass('public.reader_bookshelf_entries') is not null
     or to_regprocedure('public.novelight_touch_reader_bookshelf_entry()') is not null then
    raise exception 'Reader bookshelf objects already exist; stop and inspect';
  end if;
end
$$;

create table public.reader_bookshelf_entries (
  user_id uuid not null references public.profiles(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  reading_state text not null default 'want_to_read'
    check (reading_state in ('want_to_read', 'reading', 'completed')),
  list_name text,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, novel_id),
  constraint reader_bookshelf_list_name_length check (
    list_name is null
    or (char_length(btrim(list_name)) between 1 and 60)
  ),
  constraint reader_bookshelf_memo_length check (char_length(memo) <= 1000)
);

comment on table public.reader_bookshelf_entries is
  'Private reader organization only; never an evaluation, Rank, LIGHT SEED, SCOUT, discovery, or exposure signal.';

create index reader_bookshelf_entries_user_state_idx
  on public.reader_bookshelf_entries(user_id, reading_state, updated_at desc);

create index reader_bookshelf_entries_user_list_idx
  on public.reader_bookshelf_entries(user_id, list_name, updated_at desc)
  where list_name is not null;

alter table public.reader_bookshelf_entries enable row level security;

revoke all on table public.reader_bookshelf_entries
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.reader_bookshelf_entries to authenticated;

create policy reader_bookshelf_entries_select_own
  on public.reader_bookshelf_entries
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy reader_bookshelf_entries_insert_own
  on public.reader_bookshelf_entries
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and exists (
      select 1
      from public.novels n
      where n.id = reader_bookshelf_entries.novel_id
        and n.status = 'published'
    )
  );

create policy reader_bookshelf_entries_update_own
  on public.reader_bookshelf_entries
  for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy reader_bookshelf_entries_delete_own
  on public.reader_bookshelf_entries
  for delete
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create function public.novelight_touch_reader_bookshelf_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.novel_id := old.novel_id;
    new.created_at := old.created_at;
  end if;

  new.list_name := nullif(pg_catalog.btrim(new.list_name), '');
  new.memo := coalesce(new.memo, '');
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

revoke all on function public.novelight_touch_reader_bookshelf_entry()
  from public, anon, authenticated;

create trigger reader_bookshelf_entries_touch
before insert or update on public.reader_bookshelf_entries
for each row execute function public.novelight_touch_reader_bookshelf_entry();

commit;
