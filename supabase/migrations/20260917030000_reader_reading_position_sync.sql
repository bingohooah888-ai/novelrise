-- NOVELIGHT competitor audit item 4: cross-device reading position sync.
--
-- Personal reading position is convenience state only. It must not affect PV,
-- valid-read qualification, LIGHT SEED, SCOUT EXP, work Rank, or exposure.
-- Anonymous readers remain device-local; authenticated readers may sync only
-- their own rows through RLS.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917030000-reader-reading-position-sync'));

do $preflight$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('auth.users') is null then
    raise exception 'auth.users, public.novels, and public.episodes are required';
  end if;
end
$preflight$;

create table public.reader_reading_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  episode_id bigint not null references public.episodes(id) on delete cascade,
  episode_number bigint not null check (episode_number >= 0),
  progress_ratio double precision not null check (progress_ratio >= 0 and progress_ratio <= 1),
  last_read_at timestamptz not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, novel_id)
);

create index reader_reading_positions_user_recent_idx
  on public.reader_reading_positions (user_id, last_read_at desc);

alter table public.reader_reading_positions enable row level security;

revoke all on table public.reader_reading_positions from public, anon, authenticated;
grant select, insert, update, delete on table public.reader_reading_positions to authenticated;
grant select, insert, update, delete on table public.reader_reading_positions to service_role;

create policy novelight_reader_reading_positions_select_own
on public.reader_reading_positions
for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy novelight_reader_reading_positions_insert_own
on public.reader_reading_positions
for insert
to authenticated
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy novelight_reader_reading_positions_update_own
on public.reader_reading_positions
for update
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy novelight_reader_reading_positions_delete_own
on public.reader_reading_positions
for delete
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create or replace function public.novelight_guard_reading_position_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where e.id = new.episode_id
       and e.novel_id = new.novel_id
       and e.status = 'published'
       and n.status = 'published'
  ) then
    raise exception 'Reading position must reference a published episode in a published novel'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.revision := 1;
    new.updated_at := now();
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.novel_id is distinct from old.novel_id then
    raise exception 'Reading position ownership keys are immutable'
      using errcode = '23514';
  end if;

  -- The browser sends the server revision it last observed. If another device
  -- has already advanced the row, preserve the current server value instead of
  -- allowing the stale writer to overwrite it.
  if new.revision is distinct from old.revision then
    return old;
  end if;

  -- A correctly-versioned request can still arrive out of order. Do not move
  -- the server position backward in time. When the timestamp and episode are
  -- identical, keep the furthest progress ratio.
  if new.last_read_at < old.last_read_at then
    return old;
  end if;

  if new.last_read_at = old.last_read_at
     and new.episode_id = old.episode_id
     and new.progress_ratio <= old.progress_ratio then
    return old;
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function public.novelight_guard_reading_position_write() from public;
revoke execute on function public.novelight_guard_reading_position_write() from anon, authenticated;
grant execute on function public.novelight_guard_reading_position_write() to service_role;

create trigger novelight_guard_reading_position_write
before insert or update on public.reader_reading_positions
for each row execute function public.novelight_guard_reading_position_write();

commit;
