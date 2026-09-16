-- NOVELIGHT beta: single-date scheduled episode publication.
--
-- Scheduled episodes remain private drafts until the database-side scheduler
-- publishes them. The author-facing schedule RPCs are owner-bound. The due-job
-- function is never exposed to anon/authenticated clients.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916100000'));

do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must remain enabled on episodes';
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
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is not null then
    raise exception 'Scheduled-publication RPC already exists; stop and inspect before applying';
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
  if p_publish_at < now() + interval '2 minutes' then
    raise exception 'Scheduled publication must be at least 2 minutes in the future' using errcode = '22023';
  end if;
  if p_publish_at > now() + interval '1 year' then
    raise exception 'Scheduled publication cannot be more than 1 year in the future' using errcode = '22023';
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

  update public.episodes e
     set scheduled_publish_at = null
   where e.id = p_episode_id
     and e.user_id = v_user_id
     and e.status = 'draft'
     and exists (
       select 1
         from public.novels n
        where n.id = e.novel_id
          and n.user_id = v_user_id
     );

  if not found then
    raise exception 'Scheduled draft not found or not owned by current user' using errcode = '42501';
  end if;

  return true;
end
$$;

-- Replace the existing draft publication RPC only to guarantee that manual
-- publication clears any pending schedule in the same atomic update.
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
         scheduled_publish_at = null
   where id = p_episode_id
     and user_id = v_user_id
     and status = 'draft';
  if not found then
    raise exception 'Draft episode publication raced with another update' using errcode = '40001';
  end if;

  return p_episode_id;
end
$$;

create function public.novelight_publish_due_episode_schedules()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_episode_id bigint;
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_novel_status text;
  v_title text;
  v_content text;
  v_scheduled_publish_at timestamptz;
  v_published integer := 0;
begin
  for v_episode_id in
    select e.id
      from public.episodes e
     where e.status = 'draft'
       and e.scheduled_publish_at is not null
       and e.scheduled_publish_at <= now()
     order by e.scheduled_publish_at, e.id
     for update skip locked
     limit 100
  loop
    select e.novel_id,
           e.episode_number,
           e.status,
           e.title,
           e.content,
           e.scheduled_publish_at,
           n.status
      into v_novel_id,
           v_episode_number,
           v_episode_status,
           v_title,
           v_content,
           v_scheduled_publish_at,
           v_novel_status
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where e.id = v_episode_id
     for update of e, n;

    if not found
       or v_episode_status <> 'draft'
       or v_scheduled_publish_at is null
       or v_scheduled_publish_at > now() then
      continue;
    end if;

    -- Invalid or no-longer-publishable scheduled drafts are cancelled instead
    -- of being retried forever by cron. The author can correct and reschedule.
    if v_episode_number is null
       or v_episode_number < 1
       or char_length(trim(coalesce(v_title, ''))) < 1
       or char_length(v_title) > 150
       or char_length(trim(coalesce(v_content, ''))) < 1
       or char_length(v_content) > 100000
       or (v_novel_status <> 'published' and v_episode_number <> 1) then
      update public.episodes
         set scheduled_publish_at = null
       where id = v_episode_id
         and status = 'draft';
      continue;
    end if;

    if v_novel_status <> 'published' then
      update public.novels
         set status = 'published'
       where id = v_novel_id
         and status <> 'published';
      if not found then
        update public.episodes
           set scheduled_publish_at = null
         where id = v_episode_id
           and status = 'draft';
        continue;
      end if;
    end if;

    update public.episodes
       set status = 'published',
           scheduled_publish_at = null
     where id = v_episode_id
       and status = 'draft'
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
revoke all on function public.novelight_publish_due_episode_schedules() from public, anon, authenticated, service_role;
grant execute on function public.novelight_schedule_episode_draft(bigint, timestamptz) to authenticated;
grant execute on function public.novelight_cancel_episode_schedule(bigint) to authenticated;

-- Hosted Supabase exposes pg_cron as an available extension. Generic local CI
-- PostgreSQL may not, so the schema/RPC migration remains replayable there.
do $$
begin
  if exists (
    select 1
      from pg_available_extensions
     where name = 'pg_cron'
  ) and not exists (
    select 1
      from pg_extension
     where extname = 'pg_cron'
  ) then
    execute 'create extension pg_cron';
  end if;
end
$$;

do $outer$
declare
  v_collision boolean := false;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    return;
  end if;

  execute 'select exists(select 1 from cron.job where jobname = $1)'
     into v_collision
     using 'novelight-publish-scheduled-episodes';
  if v_collision then
    raise exception 'Cron job novelight-publish-scheduled-episodes already exists; stop and inspect before applying';
  end if;

  execute $cron$
    select cron.schedule(
      'novelight-publish-scheduled-episodes',
      '* * * * *',
      'select public.novelight_publish_due_episode_schedules();'
    )
  $cron$;
end
$outer$;

commit;