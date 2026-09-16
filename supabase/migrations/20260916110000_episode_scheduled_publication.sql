-- NOVELIGHT beta: single-episode scheduled publication.
-- Scheduled episodes remain private drafts until the trusted database job releases them.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260916110000-episode-scheduled-publication'));

do $preflight$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must remain enabled on novels and episodes';
  end if;

  if to_regclass('public.episode_publish_schedules') is not null
     or to_regprocedure('public.novelight_schedule_episode_publication(bigint,timestamp with time zone)') is not null
     or to_regprocedure('public.novelight_cancel_episode_publication_schedule(bigint)') is not null
     or to_regprocedure('public.novelight_release_due_episode_schedules()') is not null then
    raise exception 'Scheduled publication objects already exist; stop and inspect before applying';
  end if;
end
$preflight$;

create table public.episode_publish_schedules (
  episode_id bigint primary key references public.episodes(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  scheduled_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'failed')),
  last_attempted_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint episode_publish_schedules_one_per_novel unique (novel_id)
);

create index episode_publish_schedules_due_idx
  on public.episode_publish_schedules (scheduled_at)
  where state = 'pending';

alter table public.episode_publish_schedules enable row level security;

create policy episode_publish_schedules_select_owner
on public.episode_publish_schedules
as permissive
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where e.id = episode_publish_schedules.episode_id
       and n.id = episode_publish_schedules.novel_id
       and e.user_id = (select auth.uid())
       and n.user_id = (select auth.uid())
  )
);

revoke all on table public.episode_publish_schedules from public, anon, authenticated;
grant select on table public.episode_publish_schedules to authenticated;
grant all on table public.episode_publish_schedules to service_role;

create function public.novelight_schedule_episode_publication(
  p_episode_id bigint,
  p_scheduled_at timestamptz
)
returns table (
  episode_id bigint,
  scheduled_at timestamptz,
  state text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_novel_status text;
  v_title text;
  v_content text;
  v_existing_episode_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_episode_id is null or p_scheduled_at is null then
    raise exception 'Episode and scheduled time are required' using errcode = '22023';
  end if;

  if p_scheduled_at < now() + interval '1 minute' then
    raise exception 'Scheduled time must be at least one minute in the future' using errcode = '22023';
  end if;

  if p_scheduled_at > now() + interval '1 year' then
    raise exception 'Scheduled time is too far in the future' using errcode = '22023';
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
    raise exception 'The first scheduled publication must be episode 1' using errcode = '22023';
  end if;

  select s.episode_id
    into v_existing_episode_id
    from public.episode_publish_schedules s
   where s.novel_id = v_novel_id
   for update;

  if v_existing_episode_id is not null and v_existing_episode_id <> p_episode_id then
    raise exception 'Only one episode per work can be scheduled at a time' using errcode = '23505';
  end if;

  insert into public.episode_publish_schedules as s (
    episode_id,
    novel_id,
    scheduled_at,
    state,
    last_attempted_at,
    last_error_code
  ) values (
    p_episode_id,
    v_novel_id,
    p_scheduled_at,
    'pending',
    null,
    null
  )
  on conflict (episode_id) do update
    set scheduled_at = excluded.scheduled_at,
        state = 'pending',
        last_attempted_at = null,
        last_error_code = null,
        updated_at = now();

  return query
  select s.episode_id, s.scheduled_at, s.state
    from public.episode_publish_schedules s
   where s.episode_id = p_episode_id;
end
$function$;

create function public.novelight_cancel_episode_publication_schedule(
  p_episode_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_deleted bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  delete from public.episode_publish_schedules s
   using public.episodes e, public.novels n
   where s.episode_id = p_episode_id
     and e.id = s.episode_id
     and n.id = s.novel_id
     and e.novel_id = n.id
     and e.user_id = v_user_id
     and n.user_id = v_user_id
  returning s.episode_id into v_deleted;

  return v_deleted is not null;
end
$function$;

create function public.novelight_release_due_episode_schedules()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_schedule record;
  v_episode record;
  v_released integer := 0;
begin
  for v_schedule in
    select s.episode_id, s.novel_id, s.scheduled_at
      from public.episode_publish_schedules s
     where s.state = 'pending'
       and s.scheduled_at <= now()
     order by s.scheduled_at, s.episode_id
     for update skip locked
     limit 50
  loop
    update public.episode_publish_schedules
       set last_attempted_at = now(),
           updated_at = now()
     where episode_id = v_schedule.episode_id;

    begin
      select e.id,
             e.novel_id,
             e.user_id,
             e.episode_number,
             e.title,
             e.content,
             e.status as episode_status,
             n.status as novel_status,
             n.user_id as novel_user_id
        into strict v_episode
        from public.episodes e
        join public.novels n on n.id = e.novel_id
       where e.id = v_schedule.episode_id
         and e.novel_id = v_schedule.novel_id
       for update of e, n;

      if v_episode.user_id is distinct from v_episode.novel_user_id then
        raise exception 'ownership mismatch';
      end if;

      if v_episode.episode_status <> 'draft' then
        delete from public.episode_publish_schedules
         where episode_id = v_schedule.episode_id;
        continue;
      end if;

      if v_episode.episode_number is null or v_episode.episode_number < 1
         or char_length(trim(coalesce(v_episode.title, ''))) < 1
         or char_length(v_episode.title) > 150
         or char_length(trim(coalesce(v_episode.content, ''))) < 1
         or char_length(v_episode.content) > 100000 then
        update public.episode_publish_schedules
           set state = 'failed',
               last_error_code = 'content_invalid',
               updated_at = now()
         where episode_id = v_schedule.episode_id;
        continue;
      end if;

      if v_episode.novel_status <> 'published' and v_episode.episode_number <> 1 then
        update public.episode_publish_schedules
           set state = 'failed',
               last_error_code = 'first_episode_required',
               updated_at = now()
         where episode_id = v_schedule.episode_id;
        continue;
      end if;

      if v_episode.novel_status <> 'published' then
        update public.novels
           set status = 'published'
         where id = v_episode.novel_id
           and user_id = v_episode.novel_user_id;
      end if;

      update public.episodes
         set status = 'published'
       where id = v_schedule.episode_id
         and status = 'draft';

      if not found then
        raise exception 'episode publication raced with another update';
      end if;

      delete from public.episode_publish_schedules
       where episode_id = v_schedule.episode_id;

      v_released := v_released + 1;
    exception
      when no_data_found then
        delete from public.episode_publish_schedules
         where episode_id = v_schedule.episode_id;
      when others then
        update public.episode_publish_schedules
           set state = 'failed',
               last_error_code = 'release_failed',
               updated_at = now()
         where episode_id = v_schedule.episode_id;
    end;
  end loop;

  return v_released;
end
$function$;

create function public.novelight_clear_episode_publish_schedule_after_release()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.status = 'draft' and new.status <> 'draft' then
    delete from public.episode_publish_schedules where episode_id = new.id;
  end if;
  return new;
end
$function$;

create trigger episodes_clear_publish_schedule_after_release
after update of status on public.episodes
for each row
when (old.status is distinct from new.status)
execute function public.novelight_clear_episode_publish_schedule_after_release();

revoke all on function public.novelight_schedule_episode_publication(bigint, timestamptz) from public, anon;
revoke all on function public.novelight_cancel_episode_publication_schedule(bigint) from public, anon;
revoke all on function public.novelight_release_due_episode_schedules() from public, anon, authenticated;
revoke all on function public.novelight_clear_episode_publish_schedule_after_release() from public, anon, authenticated;

grant execute on function public.novelight_schedule_episode_publication(bigint, timestamptz) to authenticated, service_role;
grant execute on function public.novelight_cancel_episode_publication_schedule(bigint) to authenticated, service_role;
grant execute on function public.novelight_release_due_episode_schedules() to service_role;
grant execute on function public.novelight_clear_episode_publish_schedule_after_release() to service_role;

-- Supabase Production exposes pg_cron, while the repository migration replay uses
-- a plain PostgreSQL image without it. Keep the migration replayable there, but
-- fail closed on Production if pg_cron is available and its bootstrap is not clean.
do $cron_bootstrap$
declare
  v_cron_available boolean;
  v_job_exists boolean;
  v_job_created boolean;
begin
  select exists (
    select 1
      from pg_available_extensions
     where name = 'pg_cron'
  ) into v_cron_available;

  if not v_cron_available then
    raise notice 'pg_cron is unavailable; skipping scheduled publication cron bootstrap in compatibility replay';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  execute
    'select exists (select 1 from cron.job where jobname = $1)'
    into v_job_exists
    using 'novelight-release-scheduled-episodes';

  if v_job_exists then
    raise exception 'Scheduled publication cron job already exists; stop and inspect before applying';
  end if;

  execute
    'select cron.schedule($1, $2, $3) is not null'
    into v_job_created
    using
      'novelight-release-scheduled-episodes',
      '* * * * *',
      'select public.novelight_release_due_episode_schedules();';

  if not coalesce(v_job_created, false) then
    raise exception 'Scheduled publication cron job could not be created';
  end if;
end
$cron_bootstrap$;

commit;