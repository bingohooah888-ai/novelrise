-- Recovery-only artifact. NEVER run automatically.
-- Restores the reviewed SCOUT enrollment function but deliberately leaves the
-- formal migration ledger untouched pending a separately approved reconciliation.
begin;
do $rollback_preflight$
begin
  if md5(pg_catalog.pg_get_functiondef(
    'public.novelight_capture_scout_campaign_entry()'::regprocedure
  )) <> '4d52acf3a1d5f52db73456357a39d5fc' then
    raise exception 'Cannot rollback an unreviewed SCOUT campaign implementation';
  end if;
end
$rollback_preflight$;

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
    v_login_at := null;
  else
    if tg_op <> 'UPDATE' then
      return new;
    end if;

    v_login_at := new.last_sign_in_at;
    if v_login_at is not distinct from old.last_sign_in_at then
      return new;
    end if;
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
do $rollback_postcheck$
begin
  if md5(pg_catalog.pg_get_functiondef(
    'public.novelight_capture_scout_campaign_entry()'::regprocedure
  )) <> 'fcf216ef3062983bea13ff4143b92f53' then
    raise exception 'Restored SCOUT campaign fingerprint differs';
  end if;
end
$rollback_postcheck$;
commit;
