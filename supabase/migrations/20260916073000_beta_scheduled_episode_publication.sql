-- NOVELIGHT beta: one-off scheduled episode publication.
--
-- Scheduled episodes remain private `draft` rows until their due time. The
-- scheduler only changes state inside PostgreSQL, so publication does not
-- depend on a reader visiting the site or on a browser remaining open.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916073000'));

do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must remain enabled on novels and episodes';
  end if;

  if to_regprocedure('public.novelight_publish_episode_draft_atomic(bigint)') is null then
    raise exception 'Existing atomic draft publication RPC is required';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'scheduled_at'
  ) then
    raise exception 'episodes.scheduled_at already exists; stop and inspect before applying';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_publication(bigint,timestamp with time zone)') is not null
     or to_regprocedure('public.novelight_publish_due_scheduled_episodes()') is not null then
    raise exception 'Scheduled publication functions already exist; stop and inspect before applying';
  end if;

  if not exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    raise exception 'pg_cron is not available in this database';
  end if;
end
$$;

create extension if not exists pg_cron;

alter table public.episodes
  add column scheduled_at timestamptz;

alter table public.episodes
  add constraint episodes_scheduled_only_while_draft
  check (scheduled_at is null or status = 'draft');

create index episodes_scheduled_at_due_idx
  on public.episodes (scheduled_at, id)
  where status = 'draft' and scheduled_at is not null;

create function public.novelight_schedule_episode_publication(
  p_episode_id bigint,
  p_publish_at timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_status text;
  v_episode_number bigint;
  v_title text;
  v_content text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select n.status,
         e.episode_number,
         e.title,
         e.content
    into v_novel_status,
         v_episode_number,
         v_title,
         v_content
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.user_id = v_user_id
     and n.user_id = v_user_id
     and e.status = 'draft'
   for update of e, n;

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;

  if p_publish_at is null then
    update public.episodes
       set scheduled_at = null
     where id = p_episode_id
       and user_id = v_user_id
       and status = 'draft';
    return null;
  end if;

  if p_publish_at < now() + interval '1 minute' then
    raise exception 'Scheduled publication must be at least one minute in the future' using errcode = '22023';
  end if;
  if v_episode_number is null or v_episode_number < 1 then
    raise exception 'A valid episode number is required before scheduling' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_title, ''))) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must contain 1 to 150 characters before scheduling' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_content, ''))) < 1 or char_length(v_content) > 100000 then
    raise exception 'Episode content must contain 1 to 100000 characters before scheduling' using errcode = '22023';
  end if;
  if v_novel_status <> 'published' and v_episode_number <> 1 then
    raise exception 'The first scheduled publication must be episode 1' using errcode = '22023';
  end if;

  update public.episodes
     set scheduled_at = p_publish_at
   where id = p_episode_id
     and user_id = v_user_id
     and status = 'draft';

  return p_publish_at;
end
$$;

create function public.novelight_publish_due_scheduled_episodes()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_published integer := 0;
begin
  for v_row in
    select e.id,
           e.novel_id,
           e.episode_number,
           e.title,
           e.content,
           n.status as novel_status
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where e.status = 'draft'
       and e.scheduled_at is not null
       and e.scheduled_at <= now()
     order by e.scheduled_at, e.id
     for update of e, n skip locked
  loop
    if v_row.episode_number is null
       or v_row.episode_number < 1
       or char_length(trim(coalesce(v_row.title, ''))) < 1
       or char_length(v_row.title) > 150
       or char_length(trim(coalesce(v_row.content, ''))) < 1
       or char_length(v_row.content) > 100000
       or (v_row.novel_status <> 'published' and v_row.episode_number <> 1) then
      update public.episodes
         set scheduled_at = null
       where id = v_row.id
         and status = 'draft';
      raise warning 'NOVELIGHT cancelled invalid scheduled episode id % before publication', v_row.id;
      continue;
    end if;

    if v_row.novel_status <> 'published' then
      update public.novels
         set status = 'published'
       where id = v_row.novel_id
         and status <> 'published';
    end if;

    update public.episodes
       set status = 'published',
           scheduled_at = null
     where id = v_row.id
       and status = 'draft';

    if found then
      v_published := v_published + 1;
    end if;
  end loop;

  return v_published;
end
$$;

-- Preserve the existing owner-authenticated atomic publication contract while
-- ensuring a manual early publication clears any pending reservation.
create or replace function public.novelight_publish_episode_draft_atomic(
  p_episode_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_novel_status text;
  v_title text;
  v_content text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select e.novel_id,
         e.episode_number,
         e.status,
         e.title,
         e.content,
         n.status
    into v_novel_id,
         v_episode_number,
         v_episode_status,
         v_title,
         v_content,
         v_novel_status
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.user_id = v_user_id
     and n.user_id = v_user_id
   for update of e, n;

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;
  if v_episode_status <> 'draft' then
    raise exception 'Only draft episodes can be published by this RPC' using errcode = '22023';
  end if;
  if v_episode_number is null or v_episode_number < 1 then
    raise exception 'A valid episode number is required before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_title, ''))) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must contain 1 to 150 characters before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_content, ''))) < 1 or char_length(v_content) > 100000 then
    raise exception 'Episode content must contain 1 to 100000 characters before publication' using errcode = '22023';
  end if;
  if v_novel_status <> 'published' and v_episode_number <> 1 then
    raise exception 'The first published episode must be episode 1' using errcode = '22023';
  end if;

  if v_novel_status <> 'published' then
    update public.novels
       set status = 'published'
     where id = v_novel_id
       and user_id = v_user_id;
    if not found then
      raise exception 'Novel could not be published by current user' using errcode = '42501';
    end if;
  end if;

  update public.episodes
     set status = 'published',
         scheduled_at = null
   where id = p_episode_id
     and user_id = v_user_id
     and status = 'draft';
  if not found then
    raise exception 'Draft episode publication raced with another update' using errcode = '40001';
  end if;

  return p_episode_id;
end
$$;

revoke all on function public.novelight_schedule_episode_publication(bigint,timestamptz) from public;
revoke all on function public.novelight_schedule_episode_publication(bigint,timestamptz) from anon;
grant execute on function public.novelight_schedule_episode_publication(bigint,timestamptz) to authenticated;

revoke all on function public.novelight_publish_due_scheduled_episodes() from public;
revoke all on function public.novelight_publish_due_scheduled_episodes() from anon;
revoke all on function public.novelight_publish_due_scheduled_episodes() from authenticated;
revoke all on function public.novelight_publish_due_scheduled_episodes() from service_role;

revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from public;
revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from anon;
grant execute on function public.novelight_publish_episode_draft_atomic(bigint) to authenticated;

select cron.schedule(
  'novelight-publish-due-episodes',
  '* * * * *',
  'select public.novelight_publish_due_scheduled_episodes();'
);

commit;
