-- NOVELIGHT Trust & Safety / Fraud Detection v1
-- Purpose: reusable risk signals for SCOUT, LIGHT SEED and campaign payout review.
-- Important: detection is an investigation aid. It must not auto-ban users.

create table if not exists public.trust_risk_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_type text not null,
  risk_weight integer not null check (risk_weight between 0 and 100),
  confidence integer not null default 50 check (confidence between 0 and 100),
  source text not null default 'automatic',
  source_id text,
  evidence jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'active' check (status in ('active','dismissed','confirmed','expired')),
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists trust_risk_signals_user_status_idx
  on public.trust_risk_signals (user_id, status, observed_at desc);
create index if not exists trust_risk_signals_type_idx
  on public.trust_risk_signals (signal_type, status, observed_at desc);

create table if not exists public.trust_risk_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  active_signal_count integer not null default 0 check (active_signal_count >= 0),
  reason_codes jsonb not null default '[]'::jsonb,
  automatic_hold boolean not null default false,
  manual_hold boolean not null default false,
  payout_hold boolean not null default false,
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed','watch','cleared','hold','confirmed_abuse')),
  last_evaluated_at timestamptz,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists trust_risk_profiles_score_idx
  on public.trust_risk_profiles (risk_score desc, updated_at desc);
create index if not exists trust_risk_profiles_hold_idx
  on public.trust_risk_profiles (payout_hold, risk_score desc);

create table if not exists public.trust_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id_a uuid not null references auth.users(id) on delete cascade,
  user_id_b uuid not null references auth.users(id) on delete cascade,
  link_type text not null check (link_type in ('shared_network','shared_network_user_agent','shared_viewer_key','rapid_registration_cluster')),
  confidence integer not null check (confidence between 0 and 100),
  evidence_count integer not null default 1 check (evidence_count >= 1),
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','dismissed','confirmed','expired')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id_a <> user_id_b),
  unique (user_id_a, user_id_b, link_type)
);

create index if not exists trust_account_links_a_idx
  on public.trust_account_links (user_id_a, status, last_seen_at desc);
create index if not exists trust_account_links_b_idx
  on public.trust_account_links (user_id_b, status, last_seen_at desc);

create table if not exists public.trust_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('clear','watch','hold','confirmed_abuse')),
  note text,
  risk_score_snapshot integer not null default 0 check (risk_score_snapshot between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trust_reviews_user_idx
  on public.trust_reviews (user_id, created_at desc);

alter table public.trust_risk_signals enable row level security;
alter table public.trust_risk_profiles enable row level security;
alter table public.trust_account_links enable row level security;
alter table public.trust_reviews enable row level security;

revoke all on public.trust_risk_signals from anon, authenticated;
revoke all on public.trust_risk_profiles from anon, authenticated;
revoke all on public.trust_account_links from anon, authenticated;
revoke all on public.trust_reviews from anon, authenticated;

grant all on public.trust_risk_signals to service_role;
grant all on public.trust_risk_profiles to service_role;
grant all on public.trust_account_links to service_role;
grant all on public.trust_reviews to service_role;

create or replace function public.novelight_trust_score_level(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when greatest(0, least(100, coalesce(p_score, 0))) >= 80 then 'critical'
    when greatest(0, least(100, coalesce(p_score, 0))) >= 60 then 'high'
    when greatest(0, least(100, coalesce(p_score, 0))) >= 30 then 'medium'
    else 'low'
  end;
$$;

revoke all on function public.novelight_trust_score_level(integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_score_level(integer) to service_role;

create or replace function public.novelight_trust_recalculate_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 0;
  v_count integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_manual_hold boolean := false;
  v_profile public.trust_risk_profiles%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select
    least(100, coalesce(sum(s.risk_weight), 0))::integer,
    count(*)::integer,
    coalesce(jsonb_agg(distinct s.signal_type), '[]'::jsonb)
  into v_score, v_count, v_reasons
  from public.trust_risk_signals s
  where s.user_id = p_user_id
    and s.status in ('active', 'confirmed')
    and (s.expires_at is null or s.expires_at > now());

  select coalesce(p.manual_hold, false)
  into v_manual_hold
  from public.trust_risk_profiles p
  where p.user_id = p_user_id;

  v_manual_hold := coalesce(v_manual_hold, false);

  insert into public.trust_risk_profiles (
    user_id, risk_score, risk_level, active_signal_count, reason_codes,
    automatic_hold, manual_hold, payout_hold, last_evaluated_at, updated_at
  ) values (
    p_user_id,
    v_score,
    public.novelight_trust_score_level(v_score),
    v_count,
    v_reasons,
    v_score >= 60,
    v_manual_hold,
    (v_score >= 60) or v_manual_hold,
    now(),
    now()
  )
  on conflict (user_id) do update set
    risk_score = excluded.risk_score,
    risk_level = excluded.risk_level,
    active_signal_count = excluded.active_signal_count,
    reason_codes = excluded.reason_codes,
    automatic_hold = excluded.automatic_hold,
    payout_hold = excluded.automatic_hold or public.trust_risk_profiles.manual_hold,
    last_evaluated_at = excluded.last_evaluated_at,
    updated_at = now()
  returning * into v_profile;

  return to_jsonb(v_profile);
end;
$$;

revoke all on function public.novelight_trust_recalculate_user(uuid) from public, anon, authenticated;
grant execute on function public.novelight_trust_recalculate_user(uuid) to service_role;

create or replace function public.novelight_trust_put_signal(
  p_user_id uuid,
  p_signal_type text,
  p_risk_weight integer,
  p_confidence integer,
  p_dedupe_key text,
  p_evidence jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or coalesce(trim(p_signal_type), '') = '' or coalesce(trim(p_dedupe_key), '') = '' then
    raise exception 'invalid trust signal';
  end if;
  if p_risk_weight < 0 or p_risk_weight > 100 or p_confidence < 0 or p_confidence > 100 then
    raise exception 'invalid trust signal score';
  end if;

  insert into public.trust_risk_signals (
    user_id, signal_type, risk_weight, confidence, source, evidence,
    dedupe_key, status, observed_at, expires_at, updated_at
  ) values (
    p_user_id, p_signal_type, p_risk_weight, p_confidence, 'automatic',
    coalesce(p_evidence, '{}'::jsonb), p_dedupe_key, 'active', now(), p_expires_at, now()
  )
  on conflict (user_id, dedupe_key) do update set
    signal_type = excluded.signal_type,
    risk_weight = excluded.risk_weight,
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    status = case
      when public.trust_risk_signals.status = 'confirmed' then 'confirmed'
      else 'active'
    end,
    observed_at = now(),
    expires_at = excluded.expires_at,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.novelight_trust_put_signal(uuid,text,integer,integer,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.novelight_trust_put_signal(uuid,text,integer,integer,text,jsonb,timestamptz) to service_role;

create or replace function public.novelight_trust_scan_user(
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
  v_shared_network integer := 0;
  v_shared_network_ua integer := 0;
  v_shared_viewer integer := 0;
  v_rapid_cluster integer := 0;
  v_invalid_xp_rows integer := 0;
  v_max_daily_read_xp integer := 0;
  v_weight integer;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_window_days < 1 or p_window_days > 180 then
    raise exception 'window_days must be between 1 and 180';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;

  v_cutoff := now() - make_interval(days => p_window_days);

  -- Expire only scanner-owned signals. Manual/confirmed evidence is preserved.
  update public.trust_risk_signals
  set status = 'expired', updated_at = now()
  where user_id = p_user_id
    and source = 'automatic'
    and status = 'active'
    and signal_type in (
      'shared_network',
      'shared_network_user_agent',
      'shared_viewer_key',
      'rapid_registration_cluster',
      'scout_xp_integrity'
    );

  -- Raw IP addresses are deliberately not copied into public Trust & Safety tables.
  with target_networks as (
    select distinct s.ip
    from auth.sessions s
    where s.user_id = p_user_id
      and s.created_at >= v_cutoff
      and s.ip is not null
  )
  select count(distinct s.user_id)::integer
  into v_shared_network
  from auth.sessions s
  join target_networks t on t.ip = s.ip
  where s.user_id <> p_user_id
    and s.created_at >= v_cutoff;

  if v_shared_network > 0 then
    v_weight := case when v_shared_network >= 4 then 15 when v_shared_network >= 2 then 10 else 5 end;
    perform public.novelight_trust_put_signal(
      p_user_id, 'shared_network', v_weight, 35, 'auto:shared_network',
      jsonb_build_object('related_account_count', v_shared_network, 'window_days', p_window_days),
      now() + interval '14 days'
    );
  end if;

  with target_sessions as (
    select distinct s.ip, nullif(trim(s.user_agent), '') as user_agent
    from auth.sessions s
    where s.user_id = p_user_id
      and s.created_at >= v_cutoff
      and s.ip is not null
      and nullif(trim(s.user_agent), '') is not null
  )
  select count(distinct s.user_id)::integer
  into v_shared_network_ua
  from auth.sessions s
  join target_sessions t
    on t.ip = s.ip and t.user_agent = nullif(trim(s.user_agent), '')
  where s.user_id <> p_user_id
    and s.created_at >= v_cutoff;

  if v_shared_network_ua > 0 then
    v_weight := case when v_shared_network_ua >= 4 then 30 when v_shared_network_ua >= 2 then 20 else 15 end;
    perform public.novelight_trust_put_signal(
      p_user_id, 'shared_network_user_agent', v_weight, 65, 'auto:shared_network_user_agent',
      jsonb_build_object('related_account_count', v_shared_network_ua, 'window_days', p_window_days),
      now() + interval '14 days'
    );
  end if;

  -- viewer_key_hash is already a privacy-preserving browser visitor key. Never copy it to evidence.
  with target_keys as (
    select distinct e.viewer_key_hash
    from public.reader_journey_events e
    where e.user_id = p_user_id
      and e.occurred_at >= v_cutoff
      and nullif(e.viewer_key_hash, '') is not null
  )
  select count(distinct e.user_id)::integer
  into v_shared_viewer
  from public.reader_journey_events e
  join target_keys t on t.viewer_key_hash = e.viewer_key_hash
  where e.user_id is not null
    and e.user_id <> p_user_id
    and e.occurred_at >= v_cutoff;

  if v_shared_viewer > 0 then
    v_weight := case when v_shared_viewer >= 3 then 45 when v_shared_viewer >= 2 then 40 else 35 end;
    perform public.novelight_trust_put_signal(
      p_user_id, 'shared_viewer_key', v_weight, 85, 'auto:shared_viewer_key',
      jsonb_build_object('related_account_count', v_shared_viewer, 'window_days', p_window_days),
      now() + interval '30 days'
    );
  end if;

  -- Shared network+UA plus near-simultaneous account creation is substantially stronger than IP alone.
  with me as (
    select u.created_at from auth.users u where u.id = p_user_id
  ), target_sessions as (
    select distinct s.ip, nullif(trim(s.user_agent), '') as user_agent
    from auth.sessions s
    where s.user_id = p_user_id
      and s.created_at >= v_cutoff
      and s.ip is not null
      and nullif(trim(s.user_agent), '') is not null
  ), related_users as (
    select distinct s.user_id
    from auth.sessions s
    join target_sessions t
      on t.ip = s.ip and t.user_agent = nullif(trim(s.user_agent), '')
    where s.user_id <> p_user_id and s.created_at >= v_cutoff
  )
  select count(*)::integer
  into v_rapid_cluster
  from related_users r
  join auth.users u on u.id = r.user_id
  cross join me
  where abs(extract(epoch from (u.created_at - me.created_at))) <= 7200;

  if v_rapid_cluster > 0 then
    perform public.novelight_trust_put_signal(
      p_user_id, 'rapid_registration_cluster', 25, 80, 'auto:rapid_registration_cluster',
      jsonb_build_object('related_account_count', v_rapid_cluster, 'creation_window_hours', 2, 'window_days', p_window_days),
      now() + interval '30 days'
    );
  end if;

  -- Current SCOUT valid-read contract is +5 XP with a 40 XP/day cap. Violations indicate integrity problems.
  select count(*)::integer
  into v_invalid_xp_rows
  from public.scout_xp_ledger x
  where x.user_id = p_user_id
    and x.occurred_at >= v_cutoff
    and x.xp_kind = 'valid_read'
    and x.xp_value <> 5;

  select coalesce(max(day_xp), 0)::integer
  into v_max_daily_read_xp
  from (
    select sum(x.xp_value)::integer as day_xp
    from public.scout_xp_ledger x
    where x.user_id = p_user_id
      and x.occurred_at >= v_cutoff
      and x.xp_kind = 'valid_read'
    group by ((x.occurred_at at time zone 'Asia/Tokyo')::date)
  ) d;

  if v_invalid_xp_rows > 0 or v_max_daily_read_xp > 40 then
    perform public.novelight_trust_put_signal(
      p_user_id, 'scout_xp_integrity', 80, 100, 'auto:scout_xp_integrity',
      jsonb_build_object('invalid_valid_read_rows', v_invalid_xp_rows, 'max_daily_valid_read_xp', v_max_daily_read_xp, 'expected_daily_cap', 40),
      null
    );
  end if;

  -- Maintain relationship rows without persisting raw IP, UA or visitor hashes.
  with target_networks as (
    select distinct s.ip
    from auth.sessions s
    where s.user_id = p_user_id and s.created_at >= v_cutoff and s.ip is not null
  ), related as (
    select s.user_id, count(*)::integer as evidence_count
    from auth.sessions s
    join target_networks t on t.ip = s.ip
    where s.user_id <> p_user_id and s.created_at >= v_cutoff
    group by s.user_id
    order by count(*) desc
    limit 25
  )
  insert into public.trust_account_links (
    user_id_a, user_id_b, link_type, confidence, evidence_count, evidence,
    status, first_seen_at, last_seen_at, updated_at
  )
  select
    case when p_user_id::text < r.user_id::text then p_user_id else r.user_id end,
    case when p_user_id::text < r.user_id::text then r.user_id else p_user_id end,
    'shared_network', 35, greatest(1, r.evidence_count),
    jsonb_build_object('window_days', p_window_days), 'active', now(), now(), now()
  from related r
  on conflict (user_id_a, user_id_b, link_type) do update set
    confidence = excluded.confidence,
    evidence_count = excluded.evidence_count,
    evidence = excluded.evidence,
    status = case when public.trust_account_links.status = 'confirmed' then 'confirmed' else 'active' end,
    last_seen_at = now(), updated_at = now();

  with target_sessions as (
    select distinct s.ip, nullif(trim(s.user_agent), '') as user_agent
    from auth.sessions s
    where s.user_id = p_user_id and s.created_at >= v_cutoff
      and s.ip is not null and nullif(trim(s.user_agent), '') is not null
  ), related as (
    select s.user_id, count(*)::integer as evidence_count
    from auth.sessions s
    join target_sessions t on t.ip = s.ip and t.user_agent = nullif(trim(s.user_agent), '')
    where s.user_id <> p_user_id and s.created_at >= v_cutoff
    group by s.user_id
    order by count(*) desc
    limit 25
  )
  insert into public.trust_account_links (
    user_id_a, user_id_b, link_type, confidence, evidence_count, evidence,
    status, first_seen_at, last_seen_at, updated_at
  )
  select
    case when p_user_id::text < r.user_id::text then p_user_id else r.user_id end,
    case when p_user_id::text < r.user_id::text then r.user_id else p_user_id end,
    'shared_network_user_agent', 65, greatest(1, r.evidence_count),
    jsonb_build_object('window_days', p_window_days), 'active', now(), now(), now()
  from related r
  on conflict (user_id_a, user_id_b, link_type) do update set
    confidence = excluded.confidence,
    evidence_count = excluded.evidence_count,
    evidence = excluded.evidence,
    status = case when public.trust_account_links.status = 'confirmed' then 'confirmed' else 'active' end,
    last_seen_at = now(), updated_at = now();

  with target_keys as (
    select distinct e.viewer_key_hash
    from public.reader_journey_events e
    where e.user_id = p_user_id and e.occurred_at >= v_cutoff and nullif(e.viewer_key_hash, '') is not null
  ), related as (
    select e.user_id, count(*)::integer as evidence_count
    from public.reader_journey_events e
    join target_keys t on t.viewer_key_hash = e.viewer_key_hash
    where e.user_id is not null and e.user_id <> p_user_id and e.occurred_at >= v_cutoff
    group by e.user_id
    order by count(*) desc
    limit 25
  )
  insert into public.trust_account_links (
    user_id_a, user_id_b, link_type, confidence, evidence_count, evidence,
    status, first_seen_at, last_seen_at, updated_at
  )
  select
    case when p_user_id::text < r.user_id::text then p_user_id else r.user_id end,
    case when p_user_id::text < r.user_id::text then r.user_id else p_user_id end,
    'shared_viewer_key', 85, greatest(1, r.evidence_count),
    jsonb_build_object('window_days', p_window_days), 'active', now(), now(), now()
  from related r
  on conflict (user_id_a, user_id_b, link_type) do update set
    confidence = excluded.confidence,
    evidence_count = excluded.evidence_count,
    evidence = excluded.evidence,
    status = case when public.trust_account_links.status = 'confirmed' then 'confirmed' else 'active' end,
    last_seen_at = now(), updated_at = now();

  v_result := public.novelight_trust_recalculate_user(p_user_id);

  return jsonb_build_object(
    'profile', v_result,
    'scan', jsonb_build_object(
      'window_days', p_window_days,
      'shared_network_accounts', v_shared_network,
      'shared_network_user_agent_accounts', v_shared_network_ua,
      'shared_viewer_key_accounts', v_shared_viewer,
      'rapid_registration_accounts', v_rapid_cluster,
      'invalid_valid_read_rows', v_invalid_xp_rows,
      'max_daily_valid_read_xp', v_max_daily_read_xp
    )
  );
end;
$$;

revoke all on function public.novelight_trust_scan_user(uuid,integer) from public, anon, authenticated;
grant execute on function public.novelight_trust_scan_user(uuid,integer) to service_role;

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
    p_user_id, p_reviewer_user_id, p_decision, nullif(trim(coalesce(p_note, '')), ''), coalesce(v_score, 0)
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
    admin_id, action, target_type, target_id, payload, result, after_state
  ) values (
    p_reviewer_user_id,
    'trust_review',
    'user',
    p_user_id::text,
    jsonb_build_object('decision', p_decision, 'note', nullif(trim(coalesce(p_note, '')), '')),
    'success',
    to_jsonb(v_profile)
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
  if p_action not in ('dismiss','confirm','reactivate') then
    raise exception 'invalid signal action';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'trust signal note is too long';
  end if;

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
    admin_id, action, target_type, target_id, payload, result, after_state
  ) values (
    p_reviewer_user_id,
    'trust_signal_' || p_action,
    'trust_signal',
    p_signal_id::text,
    jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), '')),
    'success',
    to_jsonb(v_signal)
  );

  return jsonb_build_object('signal', to_jsonb(v_signal), 'profile', v_profile);
end;
$$;

revoke all on function public.novelight_admin_trust_signal_action(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.novelight_admin_trust_signal_action(uuid,uuid,text,text) to service_role;

comment on table public.trust_risk_signals is 'Admin-only Trust & Safety evidence signals. Do not expose to end users.';
comment on table public.trust_risk_profiles is 'Admin-only risk summary. Risk score is an investigation aid, not proof of abuse.';
comment on table public.trust_account_links is 'Admin-only related-account hypotheses. Raw IP/UA/visitor hashes are intentionally not persisted here.';
comment on table public.trust_reviews is 'Human review history for Trust & Safety decisions.';
