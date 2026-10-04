-- Trust & Safety v1 follow-up: bot-behavior signals, composite scan, and audit schema alignment.

create or replace function public.novelight_trust_scan_behavior(
  p_user_id uuid,
  p_window_days integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_max_reads_5m integer := 0;
  v_gap_count integer := 0;
  v_avg_gap numeric := null;
  v_gap_stddev numeric := null;
  v_profile jsonb;
begin
  if p_user_id is null then raise exception 'user_id is required'; end if;
  if p_window_days < 1 or p_window_days > 180 then
    raise exception 'window_days must be between 1 and 180';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;

  v_cutoff := now() - make_interval(days => p_window_days);

  update public.trust_risk_signals
  set status = 'expired', updated_at = now()
  where user_id = p_user_id
    and source = 'automatic'
    and status = 'active'
    and signal_type in ('robotic_valid_read_burst','robotic_valid_read_timing');

  select coalesce(max(bucket_count), 0)::integer
  into v_max_reads_5m
  from (
    select count(*)::integer as bucket_count
    from public.reader_journey_events e
    where e.user_id = p_user_id
      and e.event_type = 'valid_read'
      and e.occurred_at >= v_cutoff
    group by date_bin(interval '5 minutes', e.occurred_at, timestamptz '2000-01-01 00:00:00+00')
  ) x;

  if v_max_reads_5m >= 8 then
    perform public.novelight_trust_put_signal(
      p_user_id,
      'robotic_valid_read_burst',
      20,
      70,
      'auto:robotic_valid_read_burst',
      jsonb_build_object('max_valid_reads_in_5m', v_max_reads_5m, 'threshold', 8, 'window_days', p_window_days),
      now() + interval '14 days'
    );
  end if;

  with ordered as (
    select
      e.occurred_at,
      extract(epoch from (e.occurred_at - lag(e.occurred_at) over (order by e.occurred_at)))::numeric as gap_seconds
    from public.reader_journey_events e
    where e.user_id = p_user_id
      and e.event_type = 'valid_read'
      and e.occurred_at >= v_cutoff
  ), gaps as (
    select gap_seconds
    from ordered
    where gap_seconds between 1 and 300
  )
  select count(*)::integer, avg(gap_seconds), stddev_pop(gap_seconds)
  into v_gap_count, v_avg_gap, v_gap_stddev
  from gaps;

  -- Repeated sub-minute valid reads at nearly identical intervals are a strong automation pattern.
  -- This remains a signal, never an automatic account ban.
  if v_gap_count >= 11
     and coalesce(v_avg_gap, 999999) <= 60
     and coalesce(v_gap_stddev, 999999) <= 1.5 then
    perform public.novelight_trust_put_signal(
      p_user_id,
      'robotic_valid_read_timing',
      45,
      90,
      'auto:robotic_valid_read_timing',
      jsonb_build_object(
        'gap_sample_count', v_gap_count,
        'average_gap_seconds', round(v_avg_gap, 2),
        'gap_stddev_seconds', round(v_gap_stddev, 2),
        'window_days', p_window_days
      ),
      now() + interval '30 days'
    );
  end if;

  v_profile := public.novelight_trust_recalculate_user(p_user_id);
  return jsonb_build_object(
    'profile', v_profile,
    'behavior_scan', jsonb_build_object(
      'window_days', p_window_days,
      'max_valid_reads_in_5m', v_max_reads_5m,
      'gap_sample_count', v_gap_count,
      'average_gap_seconds', case when v_avg_gap is null then null else round(v_avg_gap, 2) end,
      'gap_stddev_seconds', case when v_gap_stddev is null then null else round(v_gap_stddev, 2) end
    )
  );
end;
$$;

revoke all on function public.novelight_trust_scan_behavior(uuid,integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_scan_behavior(uuid,integer) to service_role;

create or replace function public.novelight_trust_full_scan_user(
  p_user_id uuid,
  p_window_days integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_behavior jsonb;
  v_profile jsonb;
begin
  v_identity := public.novelight_trust_scan_user(p_user_id, p_window_days);
  v_behavior := public.novelight_trust_scan_behavior(p_user_id, p_window_days);
  v_profile := public.novelight_trust_recalculate_user(p_user_id);
  return jsonb_build_object(
    'profile', v_profile,
    'identity_scan', v_identity -> 'scan',
    'behavior_scan', v_behavior -> 'behavior_scan'
  );
end;
$$;

revoke all on function public.novelight_trust_full_scan_user(uuid,integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_full_scan_user(uuid,integer) to service_role;

create or replace function public.novelight_admin_trust_review(
  p_reviewer_user_id uuid,
  p_user_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 0;
  v_profile public.trust_risk_profiles%rowtype;
begin
  if p_reviewer_user_id is null or p_user_id is null then
    raise exception 'reviewer and user are required';
  end if;
  if p_decision not in ('clear','watch','hold','confirmed_abuse') then
    raise exception 'invalid trust review decision';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'trust review note is too long';
  end if;

  perform public.novelight_trust_recalculate_user(p_user_id);
  select risk_score into v_score from public.trust_risk_profiles where user_id = p_user_id;

  insert into public.trust_reviews (
    user_id, reviewer_user_id, decision, note, risk_score_snapshot
  ) values (
    p_user_id, p_reviewer_user_id, p_decision,
    nullif(trim(coalesce(p_note, '')), ''), coalesce(v_score, 0)
  );

  update public.trust_risk_profiles
  set
    review_state = case p_decision
      when 'clear' then 'cleared'
      when 'watch' then 'watch'
      when 'hold' then 'hold'
      else 'confirmed_abuse'
    end,
    manual_hold = p_decision in ('hold','confirmed_abuse'),
    payout_hold = automatic_hold or (p_decision in ('hold','confirmed_abuse')),
    last_reviewed_at = now(),
    last_reviewed_by = p_reviewer_user_id,
    updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  insert into public.admin_operation_audit (
    admin_user_id, action, resource_type, resource_id, metadata
  ) values (
    p_reviewer_user_id,
    'trust_review',
    'user',
    p_user_id::text,
    jsonb_build_object(
      'decision', p_decision,
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'risk_score', v_profile.risk_score,
      'payout_hold', v_profile.payout_hold
    )
  );

  return to_jsonb(v_profile);
end;
$$;

revoke all on function public.novelight_admin_trust_review(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.novelight_admin_trust_review(uuid,uuid,text,text) to service_role;

create or replace function public.novelight_admin_trust_signal_action(
  p_reviewer_user_id uuid,
  p_signal_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_signal public.trust_risk_signals%rowtype;
  v_profile jsonb;
begin
  if p_reviewer_user_id is null then raise exception 'reviewer is required'; end if;
  if p_action not in ('dismiss','confirm','reactivate') then raise exception 'invalid signal action'; end if;
  if length(coalesce(p_note, '')) > 2000 then raise exception 'trust signal note is too long'; end if;

  select * into v_signal from public.trust_risk_signals where id = p_signal_id for update;
  if not found then raise exception 'trust signal not found'; end if;
  v_user_id := v_signal.user_id;

  update public.trust_risk_signals
  set
    status = case p_action when 'dismiss' then 'dismissed' when 'confirm' then 'confirmed' else 'active' end,
    evidence = evidence || jsonb_build_object(
      'last_admin_action', p_action,
      'last_admin_note', nullif(trim(coalesce(p_note, '')), ''),
      'last_admin_at', now()
    ),
    updated_at = now()
  where id = p_signal_id
  returning * into v_signal;

  v_profile := public.novelight_trust_recalculate_user(v_user_id);

  insert into public.admin_operation_audit (
    admin_user_id, action, resource_type, resource_id, metadata
  ) values (
    p_reviewer_user_id,
    'trust_signal_' || p_action,
    'trust_signal',
    p_signal_id::text,
    jsonb_build_object(
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'signal_type', v_signal.signal_type,
      'user_id', v_user_id,
      'status', v_signal.status
    )
  );

  return jsonb_build_object('signal', to_jsonb(v_signal), 'profile', v_profile);
end;
$$;

revoke all on function public.novelight_admin_trust_signal_action(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.novelight_admin_trust_signal_action(uuid,uuid,text,text) to service_role;
