-- Harden one existing public SECURITY DEFINER status RPC against guest writes.
-- Anonymous callers still receive the same light-seed status JSON, including
-- login_required and total_seed_count. Authenticated rank initialization,
-- tier selection and planting eligibility remain unchanged.
-- No revoke/grant: preserve the existing intentional public read permission.
begin;

CREATE OR REPLACE FUNCTION public.light_seed_status_auto_v1(p_novel_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_rank smallint;
  v_seed_type text;
  v_month date := date_trunc('month', timezone('Asia/Tokyo', now()))::date;
  v_inventory public.light_seed_monthly_inventory%rowtype;
  v_already_seeded boolean := false;
  v_has_valid_read boolean := false;
  v_is_owner boolean := false;
  v_total_seeds bigint := 0;
  v_total_used integer := 0;
  v_required_available boolean := false;
  v_reason text := 'not_published';
  v_can_plant boolean := false;
begin
  if p_novel_id is null or btrim(p_novel_id) = '' then
    return jsonb_build_object(
      'eligible', false,
      'can_plant', false,
      'reason', 'invalid_novel_id',
      'monthly_limit', 11,
      'remaining_this_month', 0,
      'total_seed_count', 0,
      'rule_version', 'beta-auto-v1'
    );
  end if;

  select n.user_id into v_author_id
  from public.novels n
  where n.id::text = p_novel_id
    and n.status = 'published' and public.novelight_is_light_seed_eligible(n.ai_usage, n.content_rating);

  if not found then
    return jsonb_build_object(
      'eligible', false,
      'can_plant', false,
      'reason', 'not_published',
      'monthly_limit', 11,
      'remaining_this_month', 0,
      'total_seed_count', 0,
      'rule_version', 'beta-auto-v1'
    );
  end if;

  -- Guest status requests must not create or update rank-state rows.
  -- Authenticated callers retain the existing rank initialization behavior.
  if v_uid is not null then
    insert into public.novel_rank_state (
      novel_id_snapshot,
      author_id_snapshot,
      current_rank,
      peak_rank
    ) values (p_novel_id, v_author_id, 1, 1)
    on conflict (novel_id_snapshot) do nothing;
  end if;

  select s.current_rank into v_rank
  from public.novel_rank_state s
  where s.novel_id_snapshot = p_novel_id;

  -- Private beta mapping. Do not expose this value or thresholds in status UI.
  v_seed_type := case
    when v_rank between 1 and 2 then 'GOLD'
    when v_rank between 3 and 4 then 'SILVER'
    else 'BRONZE'
  end;

  select count(*)::bigint into v_total_seeds
  from public.light_seeds s
  where s.novel_id_snapshot = p_novel_id;

  if v_uid is null then
    return jsonb_build_object(
      'eligible', true,
      'can_plant', false,
      'reason', 'login_required',
      'monthly_limit', 11,
      'remaining_this_month', 11,
      'already_seeded', false,
      'has_valid_read', false,
      'is_owner', false,
      'total_seed_count', v_total_seeds,
      'rule_version', 'beta-auto-v1'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('novelight:light-seed-inventory:' || v_uid::text || ':' || v_month::text, 0)
  );
  perform public.novelight_ensure_light_seed_inventory(v_uid, v_month);

  select * into v_inventory
  from public.light_seed_monthly_inventory i
  where i.user_id = v_uid
    and i.seed_month = v_month;

  v_total_used := v_inventory.gold_used + v_inventory.silver_used
    + v_inventory.bronze_used + v_inventory.legacy_used;

  v_required_available := case v_seed_type
    when 'GOLD' then v_inventory.gold_used < 6
    when 'SILVER' then v_inventory.silver_used < 3
    else v_inventory.bronze_used < 2
  end;

  select exists (
    select 1 from public.light_seeds s
    where s.reader_id = v_uid
      and s.novel_id_snapshot = p_novel_id
  ) into v_already_seeded;

  -- Preserve the 2026-09-19 final fairness contract: historical rows that do
  -- not contain server-clock foreground evidence must not unlock LIGHT SEED.
  select exists (
    select 1 from public.valid_read_events r
    where r.reader_id = v_uid
      and r.novel_id_snapshot = p_novel_id
      and r.foreground_signal
      and (r.progress_signal or r.interaction_signal)
  ) into v_has_valid_read;

  v_is_owner := v_author_id = v_uid;

  if v_is_owner then
    v_reason := 'own_novel';
  elsif v_already_seeded then
    v_reason := 'already_seeded';
  elsif not v_has_valid_read then
    v_reason := 'valid_read_required';
  elsif v_total_used >= 11 then
    v_reason := 'monthly_limit_reached';
  elsif not v_required_available then
    v_reason := 'required_seed_unavailable';
  else
    v_reason := 'eligible';
    v_can_plant := true;
  end if;

  return jsonb_build_object(
    'eligible', true,
    'can_plant', v_can_plant,
    'reason', v_reason,
    'monthly_limit', 11,
    'used_this_month', v_total_used,
    'remaining_this_month', greatest(11 - v_total_used, 0),
    'already_seeded', v_already_seeded,
    'has_valid_read', v_has_valid_read,
    'is_owner', v_is_owner,
    'total_seed_count', v_total_seeds,
    'rule_version', 'beta-auto-v1'
  );
end
$function$;

commit;
