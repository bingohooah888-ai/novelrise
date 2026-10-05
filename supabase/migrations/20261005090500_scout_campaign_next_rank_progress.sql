-- Add next-rank progress to the campaign summary without changing canonical SCOUT rank rules.

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
  v_next_rank_level integer := null;
  v_next_rank_xp integer := null;
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

  if v_rank_tier < 3 then
    v_next_rank_level := (v_rank_tier * 10) + 1;
    select t.cumulative_xp into v_next_rank_xp
    from public.scout_level_thresholds t
    where t.level = v_next_rank_level;
  end if;

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
    'next_rank_level', v_next_rank_level,
    'next_rank_xp', v_next_rank_xp,
    'xp_for_next_rank', case when v_next_rank_xp is null then 0 else greatest(0, v_next_rank_xp - v_total_xp) end,
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
