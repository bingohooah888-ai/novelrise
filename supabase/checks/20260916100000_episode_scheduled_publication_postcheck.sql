\set ON_ERROR_STOP on

do $$
declare
  v_job_count integer := 0;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
       and data_type = 'timestamp with time zone'
  ) then
    raise exception 'episodes.scheduled_publish_at is missing or has the wrong type';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.episodes'::regclass
       and conname = 'episodes_scheduled_publish_requires_draft'
       and contype = 'c'
  ) then
    raise exception 'Scheduled publication draft-only constraint is missing';
  end if;

  if to_regclass('public.episodes_scheduled_publish_due_idx') is null then
    raise exception 'Scheduled publication due index is missing';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is null
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is null then
    raise exception 'Scheduled publication RPC set is incomplete';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'Scheduled publication migration disabled episode RLS';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.novelight_schedule_episode_draft(bigint,timestamp with time zone)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.novelight_cancel_episode_schedule(bigint)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role cannot use owner-bound schedule RPCs';
  end if;

  if has_function_privilege(
    'anon',
    'public.novelight_schedule_episode_draft(bigint,timestamp with time zone)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.novelight_cancel_episode_schedule(bigint)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role can execute scheduled publication owner RPCs';
  end if;

  if has_function_privilege(
    'anon',
    'public.novelight_publish_due_episode_schedules()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.novelight_publish_due_episode_schedules()',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.novelight_publish_due_episode_schedules()',
    'EXECUTE'
  ) then
    raise exception 'Internal due-publication function is exposed to a client role';
  end if;

  if exists (
    select 1
      from pg_available_extensions
     where name = 'pg_cron'
  ) then
    if not exists (
      select 1
        from pg_extension
       where extname = 'pg_cron'
    ) then
      raise exception 'pg_cron is available but was not enabled';
    end if;

    if to_regclass('cron.job') is null then
      raise exception 'pg_cron is enabled but cron.job is unavailable';
    end if;

    execute $sql$
      select count(*)
        from cron.job
       where jobname = $1
         and schedule = '* * * * *'
         and replace(command, ' ', '') = 'selectpublic.novelight_publish_due_episode_schedules();'
    $sql$
    into v_job_count
    using 'novelight-publish-scheduled-episodes';

    if v_job_count <> 1 then
      raise exception 'Expected exactly one NOVELIGHT scheduled publication cron job, found %', v_job_count;
    end if;
  end if;
end
$$;