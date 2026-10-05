-- Fix SCOUT Level 10 campaign eligibility windows.
-- Announcement/start: 2026-10-06 06:00 JST.
-- Registration/login cutoff: 2026-10-31 23:59:59.999999 JST.
-- Existing users: first eligible login starts a 60-day window.
-- Pre-announcement logins from 2026-10-05 11:13:36 JST until campaign start are treated as starting at campaign start.
-- New users: registration timestamp starts a 60-day window.

alter table public.scout_reward_campaigns
  add column if not exists prelaunch_login_grace_starts_at timestamptz;

update public.scout_reward_campaigns
set
  starts_at = timestamptz '2026-10-06 06:00:00+09',
  ends_at = timestamptz '2026-10-31 23:59:59.999999+09',
  prelaunch_login_grace_starts_at = timestamptz '2026-10-05 11:13:36+09',
  updated_at = now()
where campaign_key = 'scout-lv10-bookcard-500';

create table if not exists public.scout_reward_campaign_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.scout_reward_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_kind text not null check (entry_kind in ('existing_user','new_user')),
  account_created_at timestamptz not null,
  first_eligible_login_at timestamptz,
  eligibility_started_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create index if not exists scout_reward_campaign_entries_user_idx
  on public.scout_reward_campaign_entries (user_id, eligibility_started_at);

alter table public.scout_reward_campaign_entries enable row level security;
revoke all on public.scout_reward_campaign_entries from anon, authenticated;
grant all on public.scout_reward_campaign_entries to service_role;

create or replace function public.novelight_capture_scout_campaign_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.scout_reward_campaigns%rowtype;
  v_login_at timestamptz;
  v_entry_kind text;
  v_eligibility_started_at timestamptz;
begin
  select * into v_campaign
  from public.scout_reward_campaigns
  where campaign_key = 'scout-lv10-bookcard-500';

  if not found or v_campaign.starts_at is null or v_campaign.ends_at is null then
    return new;
  end if;

  if new.created_at > v_campaign.ends_at then
    return new;
  end if;

  if new.created_at >= v_campaign.starts_at then
    v_entry_kind := 'new_user';
    v_eligibility_started_at := new.created_at;
    v_login_at := new.last_sign_in_at;
  else
    if tg_op <> 'UPDATE' or new.last_sign_in_at is not distinct from old.last_sign_in_at then
      return new;
    end if;

    v_login_at := new.last_sign_in_at;
    if v_login_at is null or v_login_at > v_campaign.ends_at then
      return new;
    end if;

    if v_login_at < v_campaign.starts_at then
      if v_campaign.prelaunch_login_grace_starts_at is null
         or v_login_at < v_campaign.prelaunch_login_grace_starts_at then
        return new;
      end if;
      v_eligibility_started_at := v_campaign.starts_at;
    else
      v_eligibility_started_at := v_login_at;
    end if;
    v_entry_kind := 'existing_user';
  end if;

  insert into public.scout_reward_campaign_entries (
    campaign_id,
    user_id,
    entry_kind,
    account_created_at,
    first_eligible_login_at,
    eligibility_started_at
  ) values (
    v_campaign.id,
    new.id,
    v_entry_kind,
    new.created_at,
    v_login_at,
    v_eligibility_started_at
  )
  on conflict (campaign_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.novelight_capture_scout_campaign_entry() from public, anon, authenticated;

drop trigger if exists novelight_scout_campaign_entry_on_signup on auth.users;
create trigger novelight_scout_campaign_entry_on_signup
after insert on auth.users
for each row execute function public.novelight_capture_scout_campaign_entry();

drop trigger if exists novelight_scout_campaign_entry_on_login on auth.users;
create trigger novelight_scout_campaign_entry_on_login
after update of last_sign_in_at on auth.users
for each row execute function public.novelight_capture_scout_campaign_entry();

-- Backfill users who signed in during the pre-announcement grace period before this migration runs.
insert into public.scout_reward_campaign_entries (
  campaign_id,
  user_id,
  entry_kind,
  account_created_at,
  first_eligible_login_at,
  eligibility_started_at
)
select
  c.id,
  u.id,
  'existing_user',
  u.created_at,
  u.last_sign_in_at,
  c.starts_at
from auth.users u
join public.scout_reward_campaigns c
  on c.campaign_key = 'scout-lv10-bookcard-500'
where u.created_at < c.starts_at
  and u.last_sign_in_at is not null
  and c.prelaunch_login_grace_starts_at is not null
  and u.last_sign_in_at >= c.prelaunch_login_grace_starts_at
  and u.last_sign_in_at < c.starts_at
on conflict (campaign_id, user_id) do nothing;

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
  v_entry public.scout_reward_campaign_entries%rowtype;
  v_progress jsonb;
  v_qualified_at timestamptz;
  v_eligibility_deadline timestamptz;
  v_claim_deadline timestamptz;
  v_risk public.trust_risk_profiles%rowtype;
  v_claim public.scout_reward_campaign_claims%rowtype;
  v_existing public.scout_reward_campaign_claims%rowtype;
  v_claim_status text;
  v_window_days integer;
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

  select * into v_entry
  from public.scout_reward_campaign_entries e
  where e.campaign_id = v_campaign.id and e.user_id = p_user_id;
  if not found then raise exception 'campaign entry not recorded'; end if;

  v_window_days := case
    when v_entry.entry_kind = 'new_user' then v_campaign.new_user_window_days
    else v_campaign.existing_user_window_days
  end;
  v_eligibility_deadline := v_entry.eligibility_started_at + make_interval(days => v_window_days);

  v_progress := public.novelight_scout_campaign_progress(p_user_id, p_campaign_key);
  v_qualified_at := nullif(v_progress ->> 'qualified_at', '')::timestamptz;
  if v_qualified_at is null then raise exception 'target level not reached'; end if;
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
      'entry_kind', v_entry.entry_kind,
      'account_created_at', v_entry.account_created_at,
      'first_eligible_login_at', v_entry.first_eligible_login_at,
      'eligibility_started_at', v_entry.eligibility_started_at,
      'campaign_starts_at', v_campaign.starts_at,
      'campaign_entry_closes_at', v_campaign.ends_at
    )
  )
  returning * into v_claim;

  return jsonb_build_object('already_submitted', false, 'claim', to_jsonb(v_claim));
end;
$$;

revoke all on function public.novelight_scout_campaign_submit_claim(uuid,text) from public, anon, authenticated;
grant execute on function public.novelight_scout_campaign_submit_claim(uuid,text) to service_role;

comment on table public.scout_reward_campaign_entries is
  'First-entry snapshot for SCOUT reward campaigns. Preserves the initial eligibility clock even after later logins.';
