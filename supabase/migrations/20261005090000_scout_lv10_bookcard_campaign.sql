-- NOVELIGHT SCOUT Level 10 campaign foundation.
-- Dates intentionally remain unset until the campaign schedule is formally approved.

create table if not exists public.scout_reward_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique,
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  title text not null,
  description text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  target_level integer not null default 10 check (target_level between 1 and 30),
  reward_label text not null,
  reward_value_yen integer not null check (reward_value_yen > 0),
  existing_user_window_days integer not null default 60 check (existing_user_window_days between 1 and 365),
  new_user_window_days integer not null default 60 check (new_user_window_days between 1 and 365),
  claim_window_days integer not null default 30 check (claim_window_days between 1 and 365),
  daily_valid_read_xp_cap integer not null default 40 check (daily_valid_read_xp_cap >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.scout_reward_campaign_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.scout_reward_campaigns(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in ('approved_candidate','risk_review','approved','rejected','fulfilled')),
  qualified_at timestamptz not null,
  eligibility_deadline_at timestamptz not null,
  claim_deadline_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  risk_score_snapshot integer not null default 0 check (risk_score_snapshot between 0 and 100),
  risk_level_snapshot text not null default 'low' check (risk_level_snapshot in ('low','medium','high','critical')),
  payout_hold_snapshot boolean not null default false,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create index if not exists scout_reward_campaign_claims_status_idx
  on public.scout_reward_campaign_claims (status, submitted_at asc);
create index if not exists scout_reward_campaign_claims_user_idx
  on public.scout_reward_campaign_claims (user_id, submitted_at desc);

alter table public.scout_reward_campaigns enable row level security;
alter table public.scout_reward_campaign_claims enable row level security;

revoke all on public.scout_reward_campaigns from anon, authenticated;
revoke all on public.scout_reward_campaign_claims from anon, authenticated;
grant all on public.scout_reward_campaigns to service_role;
grant all on public.scout_reward_campaign_claims to service_role;

insert into public.scout_reward_campaigns (
  campaign_key,
  status,
  title,
  description,
  target_level,
  reward_label,
  reward_value_yen,
  existing_user_window_days,
  new_user_window_days,
  claim_window_days,
  daily_valid_read_xp_cap
) values (
  'scout-lv10-bookcard-500',
  'draft',
  'SCOUT LEVEL 10 達成キャンペーン',
  'SCOUT LEVEL 10を達成した方へ、図書カードネットギフト500円分をプレゼントします。',
  10,
  '図書カードネットギフト500円分',
  500,
  60,
  60,
  30,
  40
)
on conflict (campaign_key) do nothing;

create or replace function public.novelight_scout_campaign_progress(
  p_user_id uuid,
  p_campaign_key text default 'scout-lv10-bookcard-500'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.scout_reward_campaigns%rowtype;
  v_total_xp integer := 0;
  v_level integer := 1;
  v_rank_tier integer := 1;
  v_level_floor integer := 0;
  v_next_level_xp integer := 0;
  v_target_xp integer := 0;
  v_today_valid_read_xp integer := 0;
  v_qualified_at timestamptz := null;
begin
  if p_user_id is null then raise exception 'user_id is required'; end if;

  select * into v_campaign
  from public.scout_reward_campaigns
  where campaign_key = p_campaign_key;
  if not found then raise exception 'campaign not found'; end if;

  select coalesce(sum(x.xp_value), 0)::integer
  into v_total_xp
  from public.scout_xp_ledger x
  where x.user_id = p_user_id
    and x.xp_kind <> 'light_seed_discovery';

  v_level := public.novelight_scout_level_for_xp(v_total_xp);
  v_rank_tier := least(3, ((v_level - 1) / 10) + 1)::integer;

  select t.cumulative_xp into v_level_floor
  from public.scout_level_thresholds t
  where t.level = v_level;

  select t.cumulative_xp into v_next_level_xp
  from public.scout_level_thresholds t
  where t.level = least(30, v_level + 1);

  select t.cumulative_xp into v_target_xp
  from public.scout_level_thresholds t
  where t.level = v_campaign.target_level;

  select coalesce(sum(x.xp_value), 0)::integer
  into v_today_valid_read_xp
  from public.scout_xp_ledger x
  where x.user_id = p_user_id
    and x.xp_kind = 'valid_read'
    and (x.occurred_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date;

  with ordered_xp as (
    select
      x.id,
      x.occurred_at,
      sum(x.xp_value) over (
        order by x.occurred_at, x.id
        rows between unbounded preceding and current row
      ) as running_xp
    from public.scout_xp_ledger x
    where x.user_id = p_user_id
      and x.xp_kind <> 'light_seed_discovery'
  )
  select o.occurred_at into v_qualified_at
  from ordered_xp o
  where o.running_xp >= v_target_xp
  order by o.occurred_at, o.id
  limit 1;

  return jsonb_build_object(
    'total_xp', v_total_xp,
    'level', v_level,
    'rank_tier', v_rank_tier,
    'level_floor_xp', coalesce(v_level_floor, 0),
    'next_level_xp', coalesce(v_next_level_xp, v_total_xp),
    'xp_for_next_level', greatest(0, coalesce(v_next_level_xp, v_total_xp) - v_total_xp),
    'target_level', v_campaign.target_level,
    'target_level_xp', v_target_xp,
    'xp_to_target', greatest(0, v_target_xp - v_total_xp),
    'qualified_at', v_qualified_at,
    'today_valid_read_xp', v_today_valid_read_xp,
    'today_valid_read_xp_cap', v_campaign.daily_valid_read_xp_cap,
    'today_valid_read_xp_remaining', greatest(0, v_campaign.daily_valid_read_xp_cap - v_today_valid_read_xp)
  );
end;
$$;

revoke all on function public.novelight_scout_campaign_progress(uuid,text) from public, anon, authenticated;
grant execute on function public.novelight_scout_campaign_progress(uuid,text) to service_role;

create or replace function public.novelight_scout_campaign_submit_claim(
  p_user_id uuid,
  p_campaign_key text default 'scout-lv10-bookcard-500'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.scout_reward_campaigns%rowtype;
  v_user_created_at timestamptz;
  v_progress jsonb;
  v_qualified_at timestamptz;
  v_eligibility_deadline timestamptz;
  v_claim_deadline timestamptz;
  v_risk public.trust_risk_profiles%rowtype;
  v_claim public.scout_reward_campaign_claims%rowtype;
  v_existing public.scout_reward_campaign_claims%rowtype;
  v_claim_status text;
begin
  if p_user_id is null then raise exception 'user_id is required'; end if;

  select * into v_campaign
  from public.scout_reward_campaigns
  where campaign_key = p_campaign_key
  for update;
  if not found then raise exception 'campaign not found'; end if;

  select * into v_existing
  from public.scout_reward_campaign_claims c
  where c.campaign_id = v_campaign.id and c.user_id = p_user_id;
  if found then
    return jsonb_build_object('already_submitted', true, 'claim', to_jsonb(v_existing));
  end if;

  if v_campaign.status <> 'active' or v_campaign.starts_at is null or v_campaign.ends_at is null then
    raise exception 'campaign is not active';
  end if;
  if now() < v_campaign.starts_at then raise exception 'campaign has not started'; end if;

  select u.created_at into v_user_created_at from auth.users u where u.id = p_user_id;
  if v_user_created_at is null then raise exception 'user not found'; end if;
  if v_user_created_at > v_campaign.ends_at then raise exception 'campaign entry period has ended'; end if;

  v_progress := public.novelight_scout_campaign_progress(p_user_id, p_campaign_key);
  v_qualified_at := nullif(v_progress ->> 'qualified_at', '')::timestamptz;
  if v_qualified_at is null then raise exception 'target level not reached'; end if;

  if v_user_created_at < v_campaign.starts_at then
    v_eligibility_deadline := v_campaign.starts_at + make_interval(days => v_campaign.existing_user_window_days);
  else
    v_eligibility_deadline := v_user_created_at + make_interval(days => v_campaign.new_user_window_days);
  end if;

  if v_qualified_at > v_eligibility_deadline then raise exception 'target level reached after eligibility deadline'; end if;

  v_claim_deadline := v_qualified_at + make_interval(days => v_campaign.claim_window_days);
  if now() > v_claim_deadline then raise exception 'claim deadline has passed'; end if;

  perform public.novelight_trust_scan_user(p_user_id, greatest(v_campaign.existing_user_window_days, v_campaign.new_user_window_days));
  select * into v_risk from public.trust_risk_profiles r where r.user_id = p_user_id;

  v_claim_status := case when coalesce(v_risk.payout_hold, false) then 'risk_review' else 'approved_candidate' end;

  insert into public.scout_reward_campaign_claims (
    campaign_id,
    user_id,
    status,
    qualified_at,
    eligibility_deadline_at,
    claim_deadline_at,
    risk_score_snapshot,
    risk_level_snapshot,
    payout_hold_snapshot,
    eligibility_snapshot
  ) values (
    v_campaign.id,
    p_user_id,
    v_claim_status,
    v_qualified_at,
    v_eligibility_deadline,
    v_claim_deadline,
    coalesce(v_risk.risk_score, 0),
    coalesce(v_risk.risk_level, 'low'),
    coalesce(v_risk.payout_hold, false),
    jsonb_build_object(
      'campaign_key', v_campaign.campaign_key,
      'target_level', v_campaign.target_level,
      'target_level_xp', v_progress -> 'target_level_xp',
      'total_xp', v_progress -> 'total_xp',
      'level', v_progress -> 'level',
      'account_created_at', v_user_created_at,
      'campaign_starts_at', v_campaign.starts_at,
      'campaign_ends_at', v_campaign.ends_at
    )
  )
  returning * into v_claim;

  return jsonb_build_object('already_submitted', false, 'claim', to_jsonb(v_claim));
end;
$$;

revoke all on function public.novelight_scout_campaign_submit_claim(uuid,text) from public, anon, authenticated;
grant execute on function public.novelight_scout_campaign_submit_claim(uuid,text) to service_role;

comment on table public.scout_reward_campaigns is 'Server-managed SCOUT reward campaign configuration. Schedule stays draft until formally approved.';
comment on table public.scout_reward_campaign_claims is 'Server-managed one-per-user reward claims. No gift code is stored here.';
