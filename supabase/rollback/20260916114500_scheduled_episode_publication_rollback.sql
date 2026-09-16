begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916114500:rollback'));

do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid
      into v_job_id
    from cron.job
    where jobname = 'novelight-publish-due-episodes'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;
  end if;
end
$$;

drop function if exists public.novelight_publish_due_episodes();
drop function if exists public.novelight_cancel_episode_schedule(bigint);
drop function if exists public.novelight_schedule_episode_publication(bigint,timestamptz);

drop trigger if exists novelight_clear_episode_schedule_on_publish on public.episodes;
drop function if exists public.novelight_clear_episode_schedule_on_publish();

drop index if exists public.episodes_scheduled_publish_due_idx;
drop index if exists public.episodes_one_scheduled_draft_per_novel_idx;

alter table public.episodes
  drop column if exists scheduled_publish_error,
  drop column if exists scheduled_publish_at;

-- pg_cron is intentionally retained because extensions are shared infrastructure
-- and may be reused by later jobs.

commit;
