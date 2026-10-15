-- Revert the new dual-axis rules only before contest collection begins.
-- Never execute on Production without a new migration approval. Stop if ANY
-- contest sessions/events/scores/rank rows exist; later reversal requires
-- evidence-preserving forward repair, not silent deletion or recalculation.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261015120000:contest-chars-v2')
);
do $fail_closed$
begin
  if exists (select 1 from public.novelight_contest_read_sessions)
     or exists (select 1 from public.novelight_contest_read_events)
     or exists (select 1 from public.novelight_contest_reader_scores)
     or exists (select 1 from public.novelight_contest_rank_rows)
  then
    raise exception 'Contest evidence exists; rollback requires reviewed data-preserving repair';
  end if;
end
$fail_closed$;

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
revoke all on function public.novelight_contest_recompute_reader_score(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.novelight_contest_recompute_reader_score(uuid,uuid,uuid) to service_role;

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
revoke all on function public.novelight_contest_record_qualified_session(uuid) from public,anon,authenticated;
grant execute on function public.novelight_contest_record_qualified_session(uuid) to service_role;

create or replace function public.novelight_contest_heartbeat_read_session(
  p_session_id uuid,
  p_reader_id uuid,
  p_sequence integer,
  p_progress_ratio numeric,
  p_foreground boolean,
  p_interacted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $heartbeat$
declare
  v_session public.novelight_contest_read_sessions%rowtype;
  v_contest public.novelight_contests%rowtype;
  v_reader public.novelight_contest_readers%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_delta numeric;
  v_seconds integer;
  v_ratio numeric;
  v_interactions integer;
  v_required_seconds integer;
  v_qualified boolean;
begin
  if p_session_id is null or p_reader_id is null
     or p_sequence is null or p_sequence <= 0
     or p_progress_ratio is null
     or p_progress_ratio < 0 or p_progress_ratio > 1
     or p_foreground is null or p_interacted is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  select * into v_session from public.novelight_contest_read_sessions
   where id = p_session_id and reader_id = p_reader_id
   for update;
  if v_session.id is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','session_missing');
  end if;

  select * into v_contest from public.novelight_contests
   where id = v_session.contest_id;
  if v_contest.id is null
     or v_contest.status <> 'active'
     or v_contest.public_visible is not true
     or v_now < v_contest.starts_at or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;

  select * into v_reader from public.novelight_contest_readers
   where id = p_reader_id and contest_id = v_contest.id;
  if v_reader.id is null
     or v_reader.review_status in ('review_hold','excluded','merged') then
    return pg_catalog.jsonb_build_object('ok',false,'reason','reader_unavailable');
  end if;
  if v_session.status = 'qualified' then
    return pg_catalog.jsonb_build_object(
      'ok',true, 'qualified',true, 'provisional_only',true
    );
  end if;
  if v_session.status <> 'active'
     or v_session.started_at < v_contest.starts_at
     or v_now >= v_session.started_at + interval '30 minutes'
     or v_session.last_heartbeat_at >= v_now then
    return pg_catalog.jsonb_build_object('ok',false,'reason','session_expired');
  end if;
  if p_sequence <> v_session.last_sequence + 1 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_sequence');
  end if;

  v_delta := extract(epoch from v_now - v_session.last_heartbeat_at);
  if v_delta < 8 or v_delta > 45 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_interval');
  end if;
  v_seconds := v_session.foreground_seconds
    + case when p_foreground then least(
       pg_catalog.floor(v_delta)::integer, 15
      ) else 0 end;
  v_ratio := greatest(
    v_session.maximum_progress_ratio, p_progress_ratio
  );
  v_interactions := v_session.interaction_count
    + case when p_foreground and p_interacted then 1 else 0 end;
  v_required_seconds := case
    when v_session.reading_mode = 'tts' then 45 else 30 end;
  v_qualified := v_seconds >= v_required_seconds
    and v_ratio >= 0.8
    and v_interactions >= 1;

  update public.novelight_contest_read_sessions
     set last_heartbeat_at = v_now,
         last_sequence = p_sequence,
         foreground_seconds = v_seconds,
         maximum_progress_ratio = v_ratio,
         interaction_count = v_interactions,
         status = case when v_qualified then 'qualified' else 'active' end,
         updated_at = v_now
   where id = v_session.id;

  return pg_catalog.jsonb_build_object(
    'ok',true, 'qualified',v_qualified, 'provisional_only',true,
    'foreground_seconds',v_seconds
  );
end
$heartbeat$;
revoke all on function public.novelight_contest_heartbeat_read_session(uuid,uuid,integer,numeric,boolean,boolean) from public,anon,authenticated;
grant execute on function public.novelight_contest_heartbeat_read_session(uuid,uuid,integer,numeric,boolean,boolean) to service_role;

create or replace function public.novelight_contest_link_guest_account(
  p_contest_id uuid,
  p_guest_key_hash text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $link$
declare
  v_contest public.novelight_contests%rowtype;
  v_guest public.novelight_contest_readers%rowtype;
  v_account public.novelight_contest_readers%rowtype;
  v_entry_id uuid;
  v_inserted integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_contest_id is null or p_user_id is null or
     p_guest_key_hash is null or
     p_guest_key_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  select * into v_contest
    from public.novelight_contests
   where id = p_contest_id
     and contest_key = 'novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active' or
     v_contest.public_visible is not true or
     v_now < v_contest.starts_at or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;

  -- The HTTP boundary has already validated the bearer token and signed
  -- HttpOnly guest cookie. Here we serialize guest ownership before copying.
  select * into v_guest
    from public.novelight_contest_readers
   where contest_id = v_contest.id and kind = 'guest'
     and guest_key_hash = p_guest_key_hash
   for update;
  if v_guest.id is null then
    return pg_catalog.jsonb_build_object(
      'ok',true,'linked',false,'reason','no_guest_evidence',
      'provisional_only',true
    );
  end if;

  if v_guest.review_status = 'merged' then
    if exists (
      select 1 from public.novelight_contest_readers a
       where a.id = v_guest.merged_into_reader_id
         and a.contest_id = v_contest.id and a.kind = 'account'
         and a.user_id = p_user_id
    ) then
      return pg_catalog.jsonb_build_object(
        'ok',true,'linked',true,'already_linked',true,
        'provisional_only',true
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','guest_already_linked'
    );
  end if;

  if v_guest.review_status not in ('provisional','cleared') then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','guest_under_review'
    );
  end if;

  insert into public.novelight_contest_readers (
    contest_id,kind,user_id
  ) values (v_contest.id,'account',p_user_id)
  on conflict do nothing;

  select * into v_account
    from public.novelight_contest_readers
   where contest_id = v_contest.id and kind = 'account'
     and user_id = p_user_id
   for update;
  if v_account.id is null or
     v_account.review_status in ('review_hold','excluded','merged') then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','account_under_review'
    );
  end if;

  -- Re-open any previous clearance: merged claims require fresh stage-07
  -- review. Qualifying points remain provisional, never final/prize-cleared.
  update public.novelight_contest_readers
     set review_status = 'provisional',
         updated_at = v_now
   where id = v_account.id and review_status = 'cleared';

  update public.novelight_contest_readers
     set review_status = 'merged',
         merged_into_reader_id = v_account.id,
         updated_at = v_now
   where id = v_guest.id;

  update public.novelight_contest_read_sessions
     set status = 'excluded', updated_at = v_now
   where reader_id = v_guest.id and status = 'active';

  -- One account/episode unique key prevents double credit even if an account
  -- already qualified the same episode. Never promote excluded/held events.
  -- Never transfer a guest read of the signed-in author's own work.
  insert into public.novelight_contest_read_events (
    contest_id,reader_id,entry_id,episode_id_snapshot,
    first_session_id,qualified_at,status,rule_version,
    evidence_summary
  )
  select e.contest_id,v_account.id,e.entry_id,e.episode_id_snapshot,
         e.first_session_id,e.qualified_at,'provisional',
         'november-2026-points-v1',
         pg_catalog.jsonb_build_object(
           'source','guest_account_link','original_event_id',e.id
         )
    from public.novelight_contest_read_events e
    join public.novelight_contest_entries entry
      on entry.id = e.entry_id and entry.contest_id = v_contest.id
   where e.contest_id = v_contest.id and e.reader_id = v_guest.id
     and e.status in ('provisional','accepted')
     and entry.author_id <> p_user_id
  on conflict (contest_id,reader_id,episode_id_snapshot) do nothing;
  get diagnostics v_inserted = row_count;

  -- Remove source credit AND rebuild target 0/1/3/5 from distinct episodes.
  -- This is one SQL transaction: no intermediate double score is observable.
  for v_entry_id in
    select distinct entry_id
      from public.novelight_contest_read_events
     where contest_id = v_contest.id
       and reader_id in (v_guest.id,v_account.id)
    union
    select distinct entry_id
      from public.novelight_contest_reader_scores
     where contest_id = v_contest.id
       and reader_id in (v_guest.id,v_account.id)
  loop
    if exists (
      select 1 from public.novelight_contest_read_events
       where contest_id = v_contest.id
         and reader_id = v_guest.id and entry_id = v_entry_id
    ) or exists (
      select 1 from public.novelight_contest_reader_scores
       where contest_id = v_contest.id
         and reader_id = v_guest.id and entry_id = v_entry_id
    ) then
      perform public.novelight_contest_recompute_reader_score(
        v_contest.id,v_guest.id,v_entry_id
      );
    end if;
    perform public.novelight_contest_recompute_reader_score(
      v_contest.id,v_account.id,v_entry_id
    );
  end loop;

  insert into public.novelight_contest_review_audit (
    contest_id,reader_id,actor_user_id,action,reason_code,
    evidence_summary
  ) values (
    v_contest.id,v_account.id,p_user_id,
    'guest_account_link_provisional','signed_guest_and_verified_auth',
    pg_catalog.jsonb_build_object(
      'guest_reader_id',v_guest.id,'copied_episodes',v_inserted
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok',true,'linked',true,'already_linked',false,
    'provisional_only',true,'copied_episodes',v_inserted
  );
end
$link$;
revoke all on function public.novelight_contest_link_guest_account(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.novelight_contest_link_guest_account(uuid,text,uuid) to service_role;

create or replace function public.novelight_contest_prepare_rank_snapshot(
  p_contest_id uuid, p_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $prepare$
declare
  v_contest public.novelight_contests%rowtype;
  v_snapshot public.novelight_contest_rank_snapshots%rowtype;
  v_scheduled timestamptz;
  v_rows integer;
begin
  v_scheduled := public.novelight_contest_rank_slot_at(p_slot);
  if p_contest_id is null or v_scheduled is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_slot');
  end if;
  select * into v_contest from public.novelight_contests
   where id = p_contest_id and contest_key = 'novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active'
     or v_contest.public_visible is not true
     or v_scheduled < v_contest.starts_at
     or v_scheduled >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','contest_inactive'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('novelight:2026:rank-slot:' || p_slot::text)
  );
  insert into public.novelight_contest_rank_snapshots (
    contest_id,cutoff_at,scheduled_publish_at,status
  ) values (p_contest_id,v_scheduled,v_scheduled,'draft')
  on conflict (contest_id,scheduled_publish_at) do nothing;
  select * into v_snapshot from public.novelight_contest_rank_snapshots
   where contest_id = p_contest_id and scheduled_publish_at = v_scheduled
   for update;
  if v_snapshot.cutoff_at <> v_scheduled then
    return pg_catalog.jsonb_build_object('ok',false,'reason','cutoff_mismatch');
  end if;
  if v_snapshot.status <> 'draft' then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','snapshot_locked'
    );
  end if;
  -- An early draft is never publishable. On or after the release slot,
  -- serialize and refresh that private draft with the actual cutoff events
  -- instead of leaving it permanently stale and impossible to publish.
  if v_snapshot.created_at < v_scheduled
     and pg_catalog.clock_timestamp() >= v_scheduled then
    delete from public.novelight_contest_rank_rows
     where snapshot_id = v_snapshot.id;
    update public.novelight_contest_rank_snapshots
       set created_at=pg_catalog.clock_timestamp()
     where id=v_snapshot.id;
  end if;
  if exists (
    select 1 from public.novelight_contest_rank_rows
     where snapshot_id = v_snapshot.id
  ) then
    return pg_catalog.jsonb_build_object(
      'ok',true,'prepared',true,'already_prepared',true,
      'snapshot_id',v_snapshot.id,'provisional_only',true
    );
  end if;

  -- Compute from immutable event evidence at cutoff, not current PV or
  -- client-supplied points. Merged/excluded/review-held readers never score.
  -- General-zone entries only; R18 and AI-generated zones are excluded
  -- before placement, exactly as in the public contest catalog.
  with eligible as materialized (
    select e.id as entry_id,e.contest_id,e.author_id
      from public.novelight_contest_entries e
      join public.novels n on n.id = e.novel_id
     where e.contest_id = p_contest_id and e.status = 'entered'
       and n.status = 'published'
       and n.content_rating in ('general','sensitive_15','mature')
       and n.ai_usage in ('human','ai_assisted')
       and (
         select pg_catalog.count(*) from public.episodes ep
          where ep.novel_id = e.novel_id and ep.status = 'published'
       ) >= v_contest.minimum_published_episodes
  ), per_reader as (
    select ev.entry_id,ev.reader_id,
           pg_catalog.count(distinct ev.episode_id_snapshot)::integer as chapters
      from public.novelight_contest_read_events ev
      join eligible en on en.entry_id = ev.entry_id
      join public.novelight_contest_readers reader
        on reader.id = ev.reader_id and reader.contest_id = p_contest_id
     where ev.contest_id = p_contest_id
       and ev.status in ('provisional','accepted')
       and ev.qualified_at >= v_contest.starts_at
       and ev.qualified_at < v_scheduled
       and reader.review_status in ('provisional','cleared')
       and not (
         reader.kind = 'account' and reader.user_id = en.author_id
       )
     group by ev.entry_id,ev.reader_id
  ), work_points as (
    select entry_id,
           pg_catalog.sum(
             case when chapters >= 10 then 5
                  when chapters >= 5 then 3
                  when chapters >= 3 then 1 else 0 end
           )::bigint as points,
           pg_catalog.count(*) filter (where chapters >= 3)::integer
             as qualifying_readers
      from per_reader
     group by entry_id
  ), ordered as (
    select en.entry_id,
           coalesce(wp.points,0)::bigint as points,
           coalesce(wp.qualifying_readers,0)::integer as qualifying_readers,
           pg_catalog.rank() over (
             order by coalesce(wp.points,0) desc
           )::integer as ordinal_rank,
           pg_catalog.row_number() over (
             order by coalesce(wp.points,0) desc,en.entry_id asc
           ) as position
      from eligible en
      left join work_points wp on wp.entry_id = en.entry_id
  )
  insert into public.novelight_contest_rank_rows (
    snapshot_id,contest_id,entry_id,ordinal_rank,points,qualifying_readers
  )
  select v_snapshot.id,p_contest_id,entry_id,ordinal_rank,points,
         qualifying_readers
    from ordered where position <= 10;
  get diagnostics v_rows = row_count;

  return pg_catalog.jsonb_build_object(
    'ok',true,'prepared',true,'already_prepared',false,
    'snapshot_id',v_snapshot.id,'row_count',v_rows,
    'provisional_only',true
  );
end
$prepare$;
revoke all on function public.novelight_contest_prepare_rank_snapshot(uuid,integer) from public,anon,authenticated;
grant execute on function public.novelight_contest_prepare_rank_snapshot(uuid,integer) to service_role;

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
revoke all on function public.novelight_contest_reader_risk_signals(uuid,uuid) from public,anon,authenticated;
grant execute on function public.novelight_contest_reader_risk_signals(uuid,uuid) to service_role;

alter table public.novelight_contest_reader_scores
  drop constraint novelight_contest_reader_scores_brackets_check;
alter table public.novelight_contest_reader_scores
  add constraint novelight_contest_reader_scores_check check (
    (qualified_episode_count < 3 and points = 0)
    or (qualified_episode_count between 3 and 4 and points = 1)
    or (qualified_episode_count between 5 and 9 and points = 3)
    or (qualified_episode_count >= 10 and points = 5)
  );
alter table public.novelight_contest_reader_scores
  drop column qualified_body_char_count;
alter table public.novelight_contest_read_events
  drop column body_char_count;
alter table public.novelight_contests
  drop column point_body_char_thresholds,
  drop column min_qualifying_episode_chars;
drop function public.novelight_contest_episode_points(integer,bigint);
commit;
