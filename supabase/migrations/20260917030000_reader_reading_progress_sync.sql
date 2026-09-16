-- NOVELIGHT cross-device reading continuity for authenticated readers.
-- Anonymous readers remain local-only. Server progress is private per user and monotonic per novel.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917030000'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'NOVELIGHT profile, novel, and episode foundations are required';
  end if;
end
$$;

create table public.reader_reading_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  episode_id bigint not null references public.episodes(id) on delete cascade,
  episode_number integer not null check (episode_number > 0),
  progress_ratio double precision not null check (progress_ratio >= 0 and progress_ratio <= 1),
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, novel_id)
);

create index reader_reading_progress_user_recent_idx
  on public.reader_reading_progress(user_id, last_read_at desc);

alter table public.reader_reading_progress enable row level security;

revoke all on table public.reader_reading_progress from public, anon, authenticated;
grant select, insert, update on table public.reader_reading_progress to authenticated;

create policy reader_reading_progress_select_own
  on public.reader_reading_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy reader_reading_progress_insert_own
  on public.reader_reading_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy reader_reading_progress_update_own
  on public.reader_reading_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.novelight_guard_reader_reading_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_episode_number integer;
  v_now timestamptz := pg_catalog.now();
  v_incoming_read_at timestamptz;
begin
  select e.episode_number
    into v_episode_number
    from public.episodes e
   where e.id = new.episode_id
     and e.novel_id = new.novel_id
     and e.status = 'published';

  if not found then
    raise exception using errcode = '23503', message = 'Published episode does not belong to novel';
  end if;

  new.episode_number := v_episode_number;
  new.progress_ratio := least(greatest(coalesce(new.progress_ratio, 0), 0), 1);
  v_incoming_read_at := coalesce(new.last_read_at, v_now);
  if v_incoming_read_at > v_now + interval '5 minutes' then
    v_incoming_read_at := v_now;
  end if;
  new.last_read_at := v_incoming_read_at;

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, v_now);
    new.updated_at := v_now;
    return new;
  end if;

  if new.user_id <> old.user_id or new.novel_id <> old.novel_id then
    raise exception using errcode = '22023', message = 'Reading progress identity cannot change';
  end if;

  new.created_at := old.created_at;
  new.last_read_at := greatest(old.last_read_at, v_incoming_read_at);

  if new.episode_number < old.episode_number then
    new.episode_id := old.episode_id;
    new.episode_number := old.episode_number;
    new.progress_ratio := old.progress_ratio;
  elsif new.episode_number = old.episode_number then
    if new.episode_id = old.episode_id then
      new.progress_ratio := greatest(old.progress_ratio, new.progress_ratio);
    elsif v_incoming_read_at <= old.last_read_at then
      new.episode_id := old.episode_id;
      new.progress_ratio := old.progress_ratio;
    end if;
  end if;

  new.updated_at := v_now;
  return new;
end
$$;

revoke all on function public.novelight_guard_reader_reading_progress() from public, anon, authenticated;

create trigger reader_reading_progress_guard
before insert or update on public.reader_reading_progress
for each row execute function public.novelight_guard_reader_reading_progress();

commit;
