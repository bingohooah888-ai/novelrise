-- Read-only verification immediately after an approved production migration.
do $postcheck$
begin
 if to_regclass('public.novel_star_ratings') is not null then
   raise exception 'Removed star rating table is still present';
 end if;
 if to_regprocedure('public.set_novel_star_rating(text,integer)') is not null
 or to_regprocedure('public.clear_novel_star_rating(text)') is not null then
   raise exception 'Star rating RPCs must be absent';
 end if;
 if (select count(*) from cron.job where jobname='novelight-recalculate-work-ranks' and active) <> 1 then
   raise exception 'Rank cron job is not active';
 end if;
 if (select count(*) from public.scout_badge_definitions where badge_id like 'reader_rating_%' and enabled) <> 0 then
   raise exception 'Obsolete rating badges are still enabled';
 end if;
 if pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure),'novel_star_ratings') <> 0 then
   raise exception 'Rank evaluator still reads star ratings';
 end if;
end;
$postcheck$;

select jobid,jobname,schedule,active,command
  from cron.job
 where jobname='novelight-recalculate-work-ranks';

-- Run after the next scheduled hourly evaluation (not during migration).
select count(*) as published_works,
       count(*) filter(where s.last_evaluated_at > now()-interval '2 hours') as fresh_evaluations,
       min(s.last_evaluated_at) as oldest_evaluation,
       max(s.last_evaluated_at) as latest_evaluation
  from public.novels n
  join public.novel_rank_state s on s.novel_id_snapshot=n.id::text
 where n.status='published';

select j.status,j.start_time,j.end_time,pg_catalog.left(coalesce(j.return_message,''),200) as result
  from cron.job_run_details j
  join cron.job c on c.jobid=j.jobid
 where c.jobname='novelight-recalculate-work-ranks'
 order by j.start_time desc limit 8;
