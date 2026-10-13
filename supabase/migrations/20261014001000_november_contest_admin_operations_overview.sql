-- Step 09: private, read-only November contest operations overview.
-- This migration DOES NOT start registration, ranking release, payouts or cron.
-- All scoring shown here is provisional; no prize eligibility is finalized.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261014001000:contest-admin-overview')
);

create or replace function public.novelight_contest_admin_operations_overview(
  p_contest_id uuid,
  p_entry_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $operations$
declare
  v_contest public.novelight_contests%rowtype;
  v_total bigint;
  v_entries jsonb;
  v_audit jsonb;
  v_entered bigint;
  v_review_hold bigint;
  v_award_pending bigint;
  v_award_hold bigint;
  v_award_approved bigint;
  v_award_paid bigint;
begin
  if p_contest_id is null
     or (p_entry_status is not null and p_entry_status not in (
       'entered','withdrawn','ineligible','disqualified'
     ))
     or p_limit is null or p_limit not in (10,20)
     or p_offset is null or p_offset < 0 or p_offset > 2000
  then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','invalid_request'
    );
  end if;

  select * into v_contest
    from public.novelight_contests
   where id = p_contest_id
     and contest_key = 'novelight-november-2026';
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','contest_not_found'
    );
  end if;

  select pg_catalog.count(*) into v_total
    from public.novelight_contest_entries e
   where e.contest_id = p_contest_id
     and (p_entry_status is null or e.status = p_entry_status);

  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
      order by rows.entered_at desc, rows.id desc),
    '[]'::jsonb
  ) into v_entries
  from (
    select e.id, e.novel_id, e.novel_title_snapshot,
           e.status, e.entered_at, e.published_episodes_at_entry,
           pg_catalog.coalesce(scores.points,0)::bigint as provisional_points,
           pg_catalog.coalesce(scores.qualifying_readers,0)::bigint
             as qualifying_readers,
           pg_catalog.coalesce(aw.status,'not_assigned') as award_status,
           aw.final_rank, aw.amount_yen, aw.paid_at
      from (
        select id, novel_id, novel_title_snapshot, status, entered_at,
               published_episodes_at_entry
          from public.novelight_contest_entries
         where contest_id = p_contest_id
           and (p_entry_status is null or status = p_entry_status)
         order by entered_at desc, id desc
         limit p_limit offset p_offset
      ) e
      left join lateral (
        select pg_catalog.coalesce(pg_catalog.sum(s.points),0)::bigint
                 as points,
               pg_catalog.count(*) filter (where s.points > 0)::bigint
                 as qualifying_readers
          from public.novelight_contest_reader_scores s
          join public.novelight_contest_readers reader
            on reader.id = s.reader_id
           and reader.contest_id = s.contest_id
         where s.contest_id = p_contest_id
           and s.entry_id = e.id
           and e.status = 'entered'
           and s.review_status in ('provisional','cleared')
           and reader.review_status in ('provisional','cleared')
      ) scores on true
      left join public.novelight_contest_awards aw
        on aw.contest_id = p_contest_id and aw.entry_id = e.id
  ) rows;

  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'action',log.action,'reason_code',log.reason_code,
      'actor_user_id',log.actor_user_id,'created_at',log.created_at
    ) order by log.created_at desc, log.id desc),
    '[]'::jsonb
  ) into v_audit
  from (
    select id, action, reason_code, actor_user_id, created_at
      from public.novelight_contest_review_audit
     where contest_id = p_contest_id
     order by created_at desc,id desc
     limit 12
  ) log;

  select pg_catalog.count(*) filter (where status = 'entered')
    into v_entered
    from public.novelight_contest_entries
   where contest_id = p_contest_id;

  select pg_catalog.count(*) into v_review_hold
    from public.novelight_contest_readers
   where contest_id = p_contest_id and review_status = 'review_hold';

  select
    pg_catalog.count(*) filter (where status = 'pending_review'),
    pg_catalog.count(*) filter (where status = 'on_hold'),
    pg_catalog.count(*) filter (where status = 'approved'),
    pg_catalog.count(*) filter (where status = 'paid')
  into v_award_pending,v_award_hold,v_award_approved,v_award_paid
  from public.novelight_contest_awards
  where contest_id = p_contest_id;

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'contest_status',v_contest.status,
    'public_visible',v_contest.public_visible,
    'total',v_total,
    'entries',v_entries,
    'audit',v_audit,
    'summary',pg_catalog.jsonb_build_object(
      'entered',v_entered,
      'review_hold_readers',v_review_hold,
      'awards_pending',v_award_pending,
      'awards_on_hold',v_award_hold,
      'awards_approved',v_award_approved,
      'awards_paid',v_award_paid
    ),
    'provisional_only',true,
    'payments_executed',false
  );
end
$operations$;

revoke all on function
  public.novelight_contest_admin_operations_overview(uuid,text,integer,integer)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_admin_operations_overview(uuid,text,integer,integer)
  to service_role;

commit;
