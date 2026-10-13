-- NOVELIGHT November contest stage 06 (part A): server-only qualified reads.
-- Safely calculate 0/1/3/5 points from DISTINCT episodes; never add brackets.
-- Draft / unpublished contests cannot credit reads. No change to PV or SCOUT.
-- Trusted session qualification and guest issuance require separate review.
-- DO NOT apply to Production without scope-specific 本番承認 and Approval Ledger.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013150500:contest-scoring')
);

do $prerequisites$
begin
  if pg_catalog.to_regclass('public.novelight_contest_read_sessions') is null
     or pg_catalog.to_regclass('public.novelight_contest_reader_scores') is null
     or pg_catalog.to_regclass('public.novelight_contest_read_events') is null then
    raise exception 'Contest stage 02 private reader tables are required';
  end if;
end
$prerequisites$;

create or replace function public.novelight_contest_episode_points(
  p_qualified_episode_count integer
)
returns integer
language sql
immutable
strict
set search_path = ''
as $points$
  select case
    when p_qualified_episode_count >= 10 then 5
    when p_qualified_episode_count >= 5 then 3
    when p_qualified_episode_count >= 3 then 1
    else 0
  end;
$points$;

revoke all on function public.novelight_contest_episode_points(integer)
  from public, anon, authenticated;
grant execute on function public.novelight_contest_episode_points(integer)
  to service_role;

-- Rebuild a score from the evidence ledger, never increment a point counter.
-- Review_hold / excluded episodes do not count. Results remain provisional
-- until independent stage 07 fraud review; no cash award is approved here.
create or replace function public.novelight_contest_recompute_reader_score(
  p_contest_id uuid,
  p_reader_id uuid,
  p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $recompute$
declare
  v_reader public.novelight_contest_readers%rowtype;
  v_entry public.novelight_contest_entries%rowtype;
  v_count integer := 0;
  v_points integer := 0;
  v_review text;
begin
  select * into v_reader
    from public.novelight_contest_readers
   where id = p_reader_id and contest_id = p_contest_id
   for update;
  select * into v_entry
    from public.novelight_contest_entries
   where id = p_entry_id and contest_id = p_contest_id;
  if v_reader.id is null or v_entry.id is null then
    raise exception using errcode = '22023',
      message = 'Invalid contest reader or entry';
  end if;

  v_review := case
    when v_reader.review_status in ('excluded','merged') then 'excluded'
    when v_reader.review_status = 'review_hold' then 'review_hold'
    when v_reader.review_status = 'cleared' then 'cleared'
    else 'provisional'
  end;

  if v_review not in ('excluded', 'review_hold')
     and not (v_reader.kind = 'account' and v_reader.user_id = v_entry.author_id)
     and v_entry.status = 'entered' then
    select pg_catalog.count(*)::integer into v_count
      from public.novelight_contest_read_events e
     where e.contest_id = p_contest_id
       and e.reader_id = p_reader_id
       and e.entry_id = p_entry_id
       and e.status in ('provisional', 'accepted');
  end if;

  v_points := public.novelight_contest_episode_points(v_count);
  if v_reader.kind = 'account' and v_reader.user_id = v_entry.author_id then
    v_review := 'excluded';
  end if;

  insert into public.novelight_contest_reader_scores (
    contest_id, reader_id, entry_id, qualified_episode_count,
    points, review_status, last_recomputed_at
  ) values (
    p_contest_id, p_reader_id, p_entry_id, v_count, v_points,
    v_review, pg_catalog.clock_timestamp()
  )
  on conflict (contest_id, reader_id, entry_id) do update
    set qualified_episode_count = excluded.qualified_episode_count,
        points = excluded.points,
        review_status = excluded.review_status,
        last_recomputed_at = excluded.last_recomputed_at;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'qualified_episodes', v_count,
    'points', v_points,
    'review_status', v_review
  );
end
$recompute$;

revoke all on function public.novelight_contest_recompute_reader_score(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_contest_recompute_reader_score(uuid,uuid,uuid)
  to service_role;

-- The caller cannot provide an arbitrary episode / points / identity claim.
-- Only a server-qualified session, held in private RLS-protected tables,
-- may be turned into an idempotent event.
create or replace function public.novelight_contest_record_qualified_session(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record$
declare
  v_session public.novelight_contest_read_sessions%rowtype;
  v_contest public.novelight_contests%rowtype;
  v_entry public.novelight_contest_entries%rowtype;
  v_reader public.novelight_contest_readers%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_inserted integer := 0;
  v_score jsonb;
begin
  select * into v_session
    from public.novelight_contest_read_sessions
   where id = p_session_id
   for update;
  if v_session.id is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','session_missing');
  end if;
  select * into v_contest from public.novelight_contests
   where id = v_session.contest_id;
  if v_contest.id is null
     or v_contest.status <> 'active'
     or v_contest.public_visible is not true
     or v_now < v_contest.starts_at
     or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;
  if v_session.status <> 'qualified'
     or v_session.started_at < v_contest.starts_at
     or v_session.started_at >= v_contest.ends_at
     or v_session.last_heartbeat_at < v_contest.starts_at
     or v_session.last_heartbeat_at >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','session_not_qualified');
  end if;

  select * into v_reader
    from public.novelight_contest_readers
   where id = v_session.reader_id and contest_id = v_contest.id
   for update;
  select * into v_entry
    from public.novelight_contest_entries
   where id = v_session.entry_id and contest_id = v_contest.id;
  if v_reader.id is null or v_entry.id is null
     or v_reader.review_status in ('excluded', 'merged', 'review_hold')
     or v_entry.status <> 'entered' then
    return pg_catalog.jsonb_build_object('ok',false,'reason','not_eligible');
  end if;
  if v_reader.kind = 'account' and v_reader.user_id = v_entry.author_id then
    return pg_catalog.jsonb_build_object('ok',false,'reason','self_read');
  end if;
  if not exists (
    select 1 from public.novels n
    join public.episodes ep
      on ep.novel_id = n.id
     and ep.id = v_session.episode_id_snapshot
     and ep.status = 'published'
    where n.id = v_entry.novel_id
      and n.status = 'published'
      and n.content_rating in ('general','sensitive_15')
      and n.ai_usage in ('human','ai_assisted')
  ) then
    return pg_catalog.jsonb_build_object('ok',false,'reason','episode_ineligible');
  end if;

  insert into public.novelight_contest_read_events (
    contest_id, reader_id, entry_id, episode_id_snapshot,
    first_session_id, status, rule_version, evidence_summary
  ) values (
    v_contest.id, v_reader.id, v_entry.id, v_session.episode_id_snapshot,
    v_session.id, 'provisional', 'november-2026-points-v1',
    pg_catalog.jsonb_build_object('source','qualified_session')
  )
  on conflict (contest_id, reader_id, episode_id_snapshot) do nothing;
  get diagnostics v_inserted = row_count;

  v_score := public.novelight_contest_recompute_reader_score(
    v_contest.id, v_reader.id, v_entry.id
  );
  return v_score || pg_catalog.jsonb_build_object(
    'new_episode', v_inserted = 1,
    'provisional_only', true
  );
end
$record$;

revoke all on function public.novelight_contest_record_qualified_session(uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_contest_record_qualified_session(uuid)
  to service_role;

commit;
