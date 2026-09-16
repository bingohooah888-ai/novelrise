-- NOVELIGHT beta: one-shot scheduled publication for episode drafts.
--
-- Authors schedule an existing private draft for a single future timestamp.
-- Due drafts are published by a database-local pg_cron worker so no browser,
-- external webhook, or service-role secret is required for timing.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260916132000-beta-scheduled-publication'));

do $$
begin
  if exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
  else
    raise notice 'pg_cron is unavailable; skipping cron extension bootstrap in compatibility replay';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must remain enabled on novels and episodes';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'scheduled_publish_at'
  ) then
    raise exception 'episodes.scheduled_publish_at already exists; stop and inspect before applying';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is not null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is not null
     or to_regprocedure('public.novelight_publish_due_scheduled_episodes()') is not null then
    raise exception 'Scheduled publication RPC/worker already exists; stop and inspect before applying';
  end if;

  if exists (
    select 1 from pg_available_extensions where name = 'pg_cron'
  ) and to_regclass('cron.job') is null then
    raise exception 'pg_cron is available but did not expose cron.job';
  end if;

  if to_regclass('cron.job') is not null and exists (
    select 1 from cron.job where jobname = 'novelight-publish-scheduled-episodes'
  ) then
    raise exception 'Scheduled publication cron job already exists; stop and inspect before applying';
  end if;
end
$$;

alter table public.episodes
  add column scheduled_publish_at timestamptz;

alter table public.episodes
  add constraint episodes_scheduled_publish_requires_draft
  check (scheduled_publish_at is null or status = 'draft');

create index episodes_scheduled_publish_due_idx
  on public.episodes (scheduled_publish_at, id)
  where status = 'draft' and scheduled_publish_at is not null;

create function public.novelight_clear_episode_schedule_on_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'draft'
     or (
       old.scheduled_publish_at is not null
       and (
         new.episode_number is distinct from old.episode_number
         or new.title is distinct from old.title
         or new.content is distinct from old.content
       )
     ) then
    new.scheduled_publish_at := null;
  end if;
  return new;
end
$$;

revoke all on function public.novelight_clear_episode_schedule_on_change() from public, anon, authenticated;

create trigger novelight_clear_episode_schedule_on_change
before update on public.episodes
for each row
execute function public.novelight_clear_episode_schedule_on_change();

create function public.novelight_schedule_episode_draft(
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
  if p_episode_id is null or p_publish_at is null then
    raise exception 'Episode and publication time are required' using errcode = '22023';
  end if;
  if p_publish_at <= now() + interval '1 minute' then
    raise exception 'Scheduled publication must be more than one minute in the future' using errcode = '22023';
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
    raise exception 'Only draft episodes can be scheduled' using errcode = '22023';
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
    raise exception 'The first published episode must be episode 1' using errcode = '22023';
  end if;

  update public.episodes
     set scheduled_publish_at = p_publish_at
   where id = p_episode_id
     and user_id = v_user_id
     and status = 'draft';

  if not found then
    raise exception 'Draft episode schedule raced with another update' using errcode = '40001';
  end if;

  return p_publish_at;
end
$$;

create function public.novelight_cancel_episode_schedule(
  p_episode_id bigint
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.episodes
     set scheduled_publish_at = null
   where id = p_episode_id
     and user_id = v_user_id
     and status = 'draft';

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;

  return true;
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
           e.user_id,
           e.episode_number,
           e.title,
           e.content,
           n.status as novel_status
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where e.status = 'draft'
       and e.scheduled_publish_at is not null
       and e.scheduled_publish_at <= now()
     order by e.scheduled_publish_at, e.id
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
         set scheduled_publish_at = null
       where id = v_row.id
         and status = 'draft';
      continue;
    end if;

    if v_row.novel_status <> 'published' then
      update public.novels
         set status = 'published'
       where id = v_row.novel_id
         and user_id = v_row.user_id
         and status <> 'published';
    end if;

    update public.episodes
       set status = 'published',
           scheduled_publish_at = null
     where id = v_row.id
       and user_id = v_row.user_id
       and status = 'draft'
       and scheduled_publish_at is not null
       and scheduled_publish_at <= now();

    if found then
      v_published := v_published + 1;
    end if;
  end loop;

  return v_published;
end
$$;

revoke all on function public.novelight_schedule_episode_draft(bigint, timestamptz) from public, anon;
revoke all on function public.novelight_cancel_episode_schedule(bigint) from public, anon;
revoke all on function public.novelight_publish_due_scheduled_episodes() from public, anon, authenticated;

grant execute on function public.novelight_schedule_episode_draft(bigint, timestamptz) to authenticated;
grant execute on function public.novelight_cancel_episode_schedule(bigint) to authenticated;
grant execute on function public.novelight_publish_due_scheduled_episodes() to service_role;

do $$
begin
  if to_regclass('cron.job') is not null then
    execute $cron$
      select cron.schedule(
        'novelight-publish-scheduled-episodes',
        '* * * * *',
        'select public.novelight_publish_due_scheduled_episodes();'
      )
    $cron$;
  else
    raise notice 'cron.job is unavailable; skipping scheduled-publication job in compatibility replay';
  end if;
end
$$;

commit;
