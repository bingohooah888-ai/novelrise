-- Exclude admin-marked synthetic test users from automatic SCOUT campaign entries.
-- Keep ordinary registration/login eligibility and campaign windows unchanged.
-- The pre-existing Auth trigger executes this function for INSERT and sign-in UPDATE.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:scout-campaign-internal-e2e-20261029'));

do $preflight$
begin
  if pg_catalog.to_regprocedure('public.novelight_capture_scout_campaign_entry()') is null
     or pg_catalog.to_regclass('public.scout_reward_campaign_entries') is null
     or pg_catalog.to_regclass('auth.users') is null then
    raise exception 'Internal campaign exclusion requires existing canonical Auth and campaign';
  end if;
  if (
    select md5(pg_catalog.pg_get_functiondef(p.oid))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'novelight_capture_scout_campaign_entry'
      and p.pronargs = 0
  ) is distinct from 'fcf216ef3062983bea13ff4143b92f53' then
    raise exception 'Unreviewed pre-existing SCOUT campaign function';
  end if;
end
$preflight$;

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
  -- Application metadata is admin-managed; do not enroll synthetic tests.
  if pg_catalog.lower(coalesce(new.raw_app_meta_data ->> 'internal_e2e', 'false'))
       in ('true', '1', 'yes') then
    return new;
  end if;

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

do $postcheck$
begin
  if md5(pg_catalog.pg_get_functiondef(
    'public.novelight_capture_scout_campaign_entry()'::regprocedure
  )) is distinct from '4d52acf3a1d5f52db73456357a39d5fc' then
    raise exception 'Campaign exclusion function fingerprint does not match review';
  end if;
end
$postcheck$;

commit;
