-- NOVELIGHT November contest stage 06 (part B): server-timed sessions.
-- Only trusted backend service_role may start or report a read. Browser
-- progress, visibility and TTS mode are untrusted evidence, not proof of a
-- human reader. Points remain provisional pending stage 07 abuse controls.
-- This migration does NOT change normal reading, PV, SCOUT, registration,
-- contest status, public visibility, or live points until explicitly approved.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013152000:session-proof')
);

do $prerequisites$
begin
  if pg_catalog.to_regprocedure(
    'public.novelight_contest_record_qualified_session(uuid)'
  ) is null then
    raise exception 'Contest stage 06 scoring core must be deployed first';
  end if;
end
$prerequisites$;

alter table public.novelight_contest_read_sessions
  add column reading_mode text not null default 'scroll'
    check (reading_mode in ('scroll','tts'));

-- Creates an evidence session. NOT callable by the browser. The future API
-- must authenticate the reader before forwarding this identity to service_role.
create or replace function public.novelight_contest_begin_read_session(
  p_reader_id uuid,
  p_episode_id bigint,
  p_mode text default 'scroll'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $begin_session$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_contest public.novelight_contests%rowtype;
  v_reader public.novelight_contest_readers%rowtype;
  v_entry public.novelight_contest_entries%rowtype;
  v_session_id uuid;
  v_pending integer;
begin
  if p_reader_id is null or p_episode_id is null
     or p_mode is null or p_mode not in ('scroll','tts') then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  select * into v_contest from public.novelight_contests
   where contest_key = 'novelight-november-2026';
  if v_contest.id is null
     or v_contest.public_visible is not true
     or v_contest.status <> 'active'
     or v_now < v_contest.starts_at or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;

  select * into v_reader from public.novelight_contest_readers
   where id = p_reader_id and contest_id = v_contest.id
   for update;
  if v_reader.id is null
     or v_reader.review_status in ('excluded','merged','review_hold') then
    return pg_catalog.jsonb_build_object('ok',false,'reason','reader_unavailable');
  end if;

  select entry.* into v_entry
    from public.episodes ep
    join public.novels n on n.id = ep.novel_id
    join public.novelight_contest_entries entry
      on entry.novel_id = n.id and entry.contest_id = v_contest.id
   where ep.id = p_episode_id and ep.status = 'published'
     and n.status = 'published'
     and n.content_rating in ('general','sensitive_15')
     and n.ai_usage in ('human','ai_assisted')
     and entry.status = 'entered';
  if v_entry.id is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','episode_unavailable');
  end if;
  if v_reader.kind = 'account'
     and v_reader.user_id = v_entry.author_id then
    return pg_catalog.jsonb_build_object('ok',false,'reason','self_read');
  end if;

  -- Bound active-session creation even if API-side throttling is absent.
  select pg_catalog.count(*)::integer into v_pending
    from public.novelight_contest_read_sessions s
   where s.reader_id = v_reader.id and s.contest_id = v_contest.id
     and s.started_at > v_now - interval '1 hour';
  if v_pending >= 25 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','rate_limited');
  end if;

  insert into public.novelight_contest_read_sessions (
    contest_id, reader_id, entry_id, episode_id_snapshot, reading_mode,
    started_at, last_heartbeat_at
  ) values (
    v_contest.id, v_reader.id, v_entry.id, p_episode_id, p_mode, v_now, v_now
  )
  returning id into v_session_id;

  return pg_catalog.jsonb_build_object(
    'ok',true, 'session_id',v_session_id,
    'reading_mode',p_mode, 'provisional_only',true
  );
end
$begin_session$;

revoke all on function public.novelight_contest_begin_read_session(uuid,bigint,text)
  from public, anon, authenticated;
grant execute on function public.novelight_contest_begin_read_session(uuid,bigint,text)
  to service_role;

-- Reports must be sequential and pass server-observed elapsed-time bounds.
-- The browser can lie about viewport/progress/playing state; these signals
-- alone are NEVER a human-uniqueness or fraud-clearance determination.
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

revoke all on function public.novelight_contest_heartbeat_read_session(
  uuid,uuid,integer,numeric,boolean,boolean
) from public, anon, authenticated;
grant execute on function public.novelight_contest_heartbeat_read_session(
  uuid,uuid,integer,numeric,boolean,boolean
) to service_role;

commit;
