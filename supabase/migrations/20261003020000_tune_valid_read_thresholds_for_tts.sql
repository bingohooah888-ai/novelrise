-- Beta tuning based on observed valid-read drop-off.
-- Keep server-timed foreground presence authoritative while requiring deeper
-- reading progress for both scrolling and TTS-assisted reading.

update public.valid_read_rules
set normal_progress_ratio = 0.80,
    short_progress_ratio = 0.80,
    normal_foreground_seconds = 30,
    rule_version = 'beta-v2',
    updated_at = now()
where id = 1;

create or replace function public.record_valid_read_progress(
  p_episode_id text,
  p_session_id uuid,
  p_progress_ratio double precision,
  p_interaction_count integer,
  p_client_seq integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id text;
  v_author_id uuid;
  v_body_chars integer;
  v_rule public.valid_read_rules%rowtype;
  v_session public.valid_read_sessions%rowtype;
  v_gap_seconds integer := 0;
  v_credit_seconds integer := 0;
  v_progress_threshold double precision;
  v_foreground_threshold integer;
  v_progress_signal boolean := false;
  v_foreground_signal boolean := false;
  v_interaction_signal boolean := false;
  v_existing boolean := false;
  v_event_id uuid;
  v_newly_qualified boolean := false;
  v_recent_sessions integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_episode_id is null or btrim(p_episode_id) = '' or p_session_id is null then
    raise exception using errcode = '22023', message = 'Valid episode and session identifiers are required';
  end if;

  if p_progress_ratio is null or p_progress_ratio < 0 or p_progress_ratio > 1
     or p_interaction_count is null or p_interaction_count < 0 or p_interaction_count > 10000
     or p_client_seq is null or p_client_seq < 0 or p_client_seq > 1000000 then
    raise exception using errcode = '22023', message = 'Reading progress payload is invalid';
  end if;

  select
    e.novel_id::text,
    e.user_id,
    char_length(coalesce(e.content, ''))::integer
  into
    v_novel_id,
    v_author_id,
    v_body_chars
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id::text = p_episode_id
    and e.status = 'published'
    and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = 'Published episode is required';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = 'Own-work reading cannot qualify';
  end if;

  select exists (
    select 1
    from public.valid_read_events e
    where e.reader_id = v_uid
      and e.episode_id_snapshot = p_episode_id
  ) into v_existing;

  if v_existing then
    return jsonb_build_object('qualified', true, 'newly_qualified', false);
  end if;

  select * into v_rule
  from public.valid_read_rules
  where id = 1;

  if not found then
    raise exception 'Valid-read rules are not configured';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'novelight:valid-read:' || v_uid::text || ':' || p_session_id::text,
      0
    )
  );

  select * into v_session
  from public.valid_read_sessions s
  where s.reader_id = v_uid
    and s.session_id = p_session_id
  for update;

  if not found then
    select count(*)::integer into v_recent_sessions
    from public.valid_read_sessions s
    where s.reader_id = v_uid
      and s.started_at >= now() - interval '1 hour';

    if v_recent_sessions >= v_rule.max_sessions_per_hour then
      raise exception using errcode = 'P0001', message = 'Reading session rate limit reached';
    end if;

    insert into public.valid_read_sessions (
      reader_id,
      session_id,
      novel_id_snapshot,
      episode_id_snapshot,
      author_id_snapshot,
      foreground_seconds,
      max_progress_ratio,
      interaction_count,
      last_client_seq,
      body_char_count
    ) values (
      v_uid,
      p_session_id,
      v_novel_id,
      p_episode_id,
      v_author_id,
      0,
      p_progress_ratio,
      p_interaction_count,
      p_client_seq,
      v_body_chars
    )
    returning * into v_session;
  else
    if v_session.episode_id_snapshot <> p_episode_id
       or v_session.novel_id_snapshot <> v_novel_id then
      raise exception using errcode = '22023', message = 'Reading session cannot change episode';
    end if;

    if p_client_seq > v_session.last_client_seq then
      v_gap_seconds := floor(extract(epoch from (now() - v_session.last_heartbeat_at)))::integer;
      if v_gap_seconds between 1 and v_rule.max_heartbeat_gap_seconds then
        v_credit_seconds := v_gap_seconds;
      else
        v_credit_seconds := 0;
      end if;

      update public.valid_read_sessions
      set foreground_seconds = foreground_seconds + v_credit_seconds,
          max_progress_ratio = greatest(max_progress_ratio, p_progress_ratio),
          interaction_count = greatest(interaction_count, p_interaction_count),
          last_client_seq = p_client_seq,
          last_heartbeat_at = now()
      where reader_id = v_uid
        and session_id = p_session_id
      returning * into v_session;
    end if;
  end if;

  if v_session.body_char_count < v_rule.normal_min_chars then
    v_progress_threshold := v_rule.short_progress_ratio;
    v_foreground_threshold := greatest(
      v_rule.min_short_foreground_seconds,
      ceil(
        v_rule.normal_foreground_seconds::numeric
        * greatest(v_session.body_char_count, 1)::numeric
        / v_rule.normal_min_chars::numeric
      )::integer
    );
    v_foreground_threshold := least(v_foreground_threshold, v_rule.normal_foreground_seconds);
  else
    v_progress_threshold := v_rule.normal_progress_ratio;
    v_foreground_threshold := v_rule.normal_foreground_seconds;
  end if;

  v_progress_signal := v_session.max_progress_ratio >= v_progress_threshold;
  v_foreground_signal := v_session.foreground_seconds >= v_foreground_threshold;
  v_interaction_signal := v_session.interaction_count >= v_rule.interaction_events;

  -- Interaction remains useful telemetry, but it must never bypass the
  -- reader reaching the required amount of the episode.
  if v_foreground_signal and v_progress_signal then
    insert into public.valid_read_events (
      reader_id,
      novel_id_snapshot,
      episode_id_snapshot,
      author_id_snapshot,
      session_id,
      body_char_count,
      progress_signal,
      foreground_signal,
      interaction_signal,
      rule_version
    ) values (
      v_uid,
      v_novel_id,
      p_episode_id,
      v_author_id,
      p_session_id,
      v_session.body_char_count,
      v_progress_signal,
      v_foreground_signal,
      v_interaction_signal,
      v_rule.rule_version
    )
    on conflict (reader_id, episode_id_snapshot) do nothing
    returning id into v_event_id;

    v_newly_qualified := v_event_id is not null;

    if v_newly_qualified then
      update public.valid_read_sessions
      set qualified_at = now()
      where reader_id = v_uid
        and session_id = p_session_id;

      insert into public.scout_event_ledger (
        user_id,
        event_type,
        event_key,
        novel_id_snapshot,
        episode_id_snapshot,
        occurred_at,
        metadata
      ) values (
        v_uid,
        'valid_read',
        'valid_read:' || v_uid::text || ':' || p_episode_id,
        v_novel_id,
        p_episode_id,
        now(),
        jsonb_build_object(
          'valid_read_event_id', v_event_id,
          'rule_version', v_rule.rule_version
        )
      )
      on conflict (event_key) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'qualified', (v_foreground_signal and v_progress_signal) or v_existing,
    'newly_qualified', v_newly_qualified
  );
end
$function$;
