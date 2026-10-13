-- NOVELIGHT November contest: Stage 07 private, read-only risk preflight.
-- An anomaly signal never disqualifies a reader or awards a prize.
-- No public data endpoint, automated punitive mutation or raw IP collection.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013171000:risk-signals')
);

create or replace function public.novelight_contest_reader_risk_signals(
  p_contest_id uuid,
  p_reader_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $risk$
declare
  v_contest public.novelight_contests%rowtype;
  v_reader public.novelight_contest_readers%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_sessions_hour integer := 0;
  v_episodes_hour integer := 0;
  v_overlaps integer := 0;
  v_invalid_qualified integer := 0;
  v_linked_guests integer := 0;
  v_signals jsonb := '[]'::jsonb;
begin
  if p_contest_id is null or p_reader_id is null then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','invalid_request'
    );
  end if;
  select * into v_contest
    from public.novelight_contests
   where id = p_contest_id and contest_key = 'novelight-november-2026';
  select * into v_reader
    from public.novelight_contest_readers
   where id = p_reader_id and contest_id = p_contest_id;

  if v_contest.id is null or v_reader.id is null then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','reader_not_found'
    );
  end if;

  select pg_catalog.count(*)::integer into v_sessions_hour
    from public.novelight_contest_read_sessions s
   where s.contest_id = p_contest_id
     and s.reader_id = p_reader_id
     and s.started_at >= v_now - interval '1 hour';

  select pg_catalog.count(*)::integer into v_episodes_hour
    from public.novelight_contest_read_events e
   where e.contest_id = p_contest_id
     and e.reader_id = p_reader_id
     and e.status in ('provisional','accepted')
     and e.qualified_at >= v_now - interval '1 hour';

  -- Overlapping foreground evidence across different episode sessions can
  -- justify human examination, but may reflect legitimate multiple tabs.
  select pg_catalog.count(*)::integer into v_overlaps
    from public.novelight_contest_read_sessions a
    join public.novelight_contest_read_sessions b
      on a.reader_id = b.reader_id
     and a.contest_id = b.contest_id and a.id < b.id
     and a.episode_id_snapshot <> b.episode_id_snapshot
     and a.started_at < b.last_heartbeat_at
     and b.started_at < a.last_heartbeat_at
   where a.contest_id = p_contest_id
     and a.reader_id = p_reader_id
     and a.started_at >= v_now - interval '24 hours'
     and b.started_at >= v_now - interval '24 hours'
     and a.foreground_seconds > 0 and b.foreground_seconds > 0;

  -- A qualified row contradicting mandatory server thresholds should be
  -- quarantined for investigation rather than silently counted as valid.
  select pg_catalog.count(*)::integer into v_invalid_qualified
    from public.novelight_contest_read_sessions s
   where s.contest_id = p_contest_id and s.reader_id = p_reader_id
     and s.status = 'qualified'
     and (
       s.maximum_progress_ratio < 0.8
       or s.interaction_count < 1
       or s.foreground_seconds < case
         when s.reading_mode = 'tts' then 45 else 30 end
     );

  if v_reader.kind = 'account' then
    select pg_catalog.count(*)::integer into v_linked_guests
      from public.novelight_contest_readers g
     where g.contest_id = p_contest_id
       and g.kind = 'guest'
       and g.review_status = 'merged'
       and g.merged_into_reader_id = p_reader_id;
  end if;

  if v_sessions_hour >= 20 then
    v_signals := v_signals || '["near_hourly_session_cap"]'::jsonb;
  end if;
  if v_episodes_hour >= 12 then
    v_signals := v_signals || '["rapid_episode_qualification"]'::jsonb;
  end if;
  if v_overlaps >= 2 then
    v_signals := v_signals || '["overlapping_episode_sessions"]'::jsonb;
  end if;
  if v_invalid_qualified > 0 then
    v_signals := v_signals || '["inconsistent_qualified_evidence"]'::jsonb;
  end if;
  if v_linked_guests >= 3 then
    v_signals := v_signals || '["multiple_linked_guest_credentials"]'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'contest_id',v_contest.id,
    'reader_id',v_reader.id,
    'review_status',v_reader.review_status,
    'signal_codes',v_signals,
    'requires_manual_review',pg_catalog.jsonb_array_length(v_signals) > 0,
    'provisional_only',true,
    'metrics',pg_catalog.jsonb_build_object(
      'sessions_last_hour',v_sessions_hour,
      'qualified_episodes_last_hour',v_episodes_hour,
      'overlapping_session_pairs_last_day',v_overlaps,
      'inconsistent_qualified_sessions',v_invalid_qualified,
      'linked_guest_credentials',v_linked_guests
    )
  );
end
$risk$;

revoke all on function
  public.novelight_contest_reader_risk_signals(uuid,uuid)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_reader_risk_signals(uuid,uuid)
  to service_role;

commit;
