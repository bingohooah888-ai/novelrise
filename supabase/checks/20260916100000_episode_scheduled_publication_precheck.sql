\set ON_ERROR_STOP on

do $$
declare
  v_cron_collision boolean := false;
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must be enabled on episodes before scheduled publication migration';
  end if;

  if to_regprocedure('public.novelight_publish_episode_draft_atomic(bigint)') is null then
    raise exception 'Existing draft publication RPC is missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
  ) then
    raise exception 'episodes.scheduled_publish_at already exists';
  end if;

  if to_regprocedure('public.novelight_schedule_episode_draft(bigint,timestamp with time zone)') is not null
     or to_regprocedure('public.novelight_cancel_episode_schedule(bigint)') is not null
     or to_regprocedure('public.novelight_publish_due_episode_schedules()') is not null then
    raise exception 'Scheduled publication RPC already exists';
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname = $1)'
       into v_cron_collision
       using 'novelight-publish-scheduled-episodes';
    if v_cron_collision then
      raise exception 'Cron job novelight-publish-scheduled-episodes already exists';
    end if;
  end if;
end
$$;