begin;

-- Beta keeps work Rank private. Readers send one generic LIGHT SEED action and
-- the server selects the seed tier from the work's internal Rank snapshot.
-- The mapping intentionally stays server-side so public clients cannot infer
-- exact Rank thresholds from the status contract.

do $$
begin
  if to_regprocedure('public.light_seed_status_v2(text)') is null then
    raise exception 'Required function light_seed_status_v2(text) is missing';
  end if;
  if to_regprocedure('public.plant_light_seed_v2(text,text)') is null then
    raise exception 'Required function plant_light_seed_v2(text,text) is missing';
  end if;
  if to_regprocedure('public.novelight_ensure_light_seed_inventory(uuid,date)') is null then
    raise exception 'Required LIGHT SEED inventory function is missing';
  end if;
end
$$;

create or replace function public.light_seed_status_auto_v1(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
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
    and n.status = 'published';

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

  insert into public.novel_rank_state (
    novel_id_snapshot,
    author_id_snapshot,
    current_rank,
    peak_rank
  ) values (p_novel_id, v_author_id, 1, 1)
  on conflict (novel_id_snapshot) do nothing;

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

  select exists (
    select 1 from public.valid_read_events r
    where r.reader_id = v_uid
      and r.novel_id_snapshot = p_novel_id
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
$$;

revoke all on function public.light_seed_status_auto_v1(text) from public, anon, authenticated;
grant execute on function public.light_seed_status_auto_v1(text) to anon, authenticated;

create or replace function public.plant_light_seed_auto_v1(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_seed_type text;
  v_author_id uuid;
  v_pv bigint;
  v_favorites integer;
  v_rank smallint;
  v_rank_code text;
  v_valid_read_id uuid;
  v_month date := date_trunc('month', timezone('Asia/Tokyo', now()))::date;
  v_inventory public.light_seed_monthly_inventory%rowtype;
  v_total_used integer;
  v_seed_id uuid;
  v_total_seeds bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'LIGHT SEED requires authentication';
  end if;

  if p_novel_id is null or btrim(p_novel_id) = '' then
    raise exception using errcode = '22023', message = 'A valid novel identifier is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('novelight:light-seed-auto:' || v_uid::text || ':' || v_month::text, 0)
  );

  select n.user_id, coalesce(n.pv, 0)::bigint
  into v_author_id, v_pv
  from public.novels n
  where n.id::text = p_novel_id
    and n.status = 'published'
  for share;

  if not found then
    raise exception using errcode = '23514', message = 'Only published works can receive LIGHT SEED';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = 'Authors cannot LIGHT SEED their own work';
  end if;

  if exists (
    select 1 from public.light_seeds s
    where s.reader_id = v_uid
      and s.novel_id_snapshot = p_novel_id
  ) then
    raise exception using errcode = '23505', message = 'This reader has already LIGHT SEEDED this work';
  end if;

  select r.id into v_valid_read_id
  from public.valid_read_events r
  where r.reader_id = v_uid
    and r.novel_id_snapshot = p_novel_id
  order by r.qualified_at asc, r.id asc
  limit 1;

  if v_valid_read_id is null then
    raise exception using errcode = '23514', message = 'A valid read is required before LIGHT SEED';
  end if;

  insert into public.novel_rank_state (
    novel_id_snapshot,
    author_id_snapshot,
    current_rank,
    peak_rank
  ) values (p_novel_id, v_author_id, 1, 1)
  on conflict (novel_id_snapshot) do nothing;

  select s.current_rank into v_rank
  from public.novel_rank_state s
  where s.novel_id_snapshot = p_novel_id
  for share;

  v_rank_code := public.novelight_rank_code(v_rank);
  v_seed_type := case
    when v_rank between 1 and 2 then 'GOLD'
    when v_rank between 3 and 4 then 'SILVER'
    else 'BRONZE'
  end;

  perform public.novelight_ensure_light_seed_inventory(v_uid, v_month);

  select * into v_inventory
  from public.light_seed_monthly_inventory i
  where i.user_id = v_uid
    and i.seed_month = v_month
  for update;

  v_total_used := v_inventory.gold_used + v_inventory.silver_used
    + v_inventory.bronze_used + v_inventory.legacy_used;

  if v_total_used >= 11 then
    raise exception using errcode = '23514', message = 'Monthly LIGHT SEED inventory is exhausted';
  end if;

  if (v_seed_type = 'GOLD' and v_inventory.gold_used >= 6)
     or (v_seed_type = 'SILVER' and v_inventory.silver_used >= 3)
     or (v_seed_type = 'BRONZE' and v_inventory.bronze_used >= 2) then
    raise exception using errcode = '23514', message = 'LIGHT SEED required by this work is exhausted';
  end if;

  select count(*)::integer into v_favorites
  from public.favorites f
  where f.novel_id::text = p_novel_id;

  update public.light_seed_monthly_inventory
  set gold_used = gold_used + case when v_seed_type = 'GOLD' then 1 else 0 end,
      silver_used = silver_used + case when v_seed_type = 'SILVER' then 1 else 0 end,
      bronze_used = bronze_used + case when v_seed_type = 'BRONZE' then 1 else 0 end,
      updated_at = now()
  where user_id = v_uid
    and seed_month = v_month;

  insert into public.light_seeds (
    reader_id,
    novel_id_snapshot,
    author_id_snapshot,
    seed_month,
    pv_at_seed,
    favorites_at_seed,
    rule_version,
    seed_type,
    rank_at_seed,
    rank_code_at_seed,
    valid_read_event_id
  ) values (
    v_uid,
    p_novel_id,
    v_author_id,
    v_month,
    v_pv,
    v_favorites,
    'beta-auto-v1',
    v_seed_type,
    v_rank,
    v_rank_code,
    v_valid_read_id
  )
  returning id into v_seed_id;

  select count(*)::bigint into v_total_seeds
  from public.light_seeds s
  where s.novel_id_snapshot = p_novel_id;

  select * into v_inventory
  from public.light_seed_monthly_inventory i
  where i.user_id = v_uid
    and i.seed_month = v_month;

  v_total_used := v_inventory.gold_used + v_inventory.silver_used
    + v_inventory.bronze_used + v_inventory.legacy_used;

  return jsonb_build_object(
    'planted', true,
    'seed_id', v_seed_id,
    'novel_id', p_novel_id,
    'seed_type', v_seed_type,
    'monthly_limit', 11,
    'used_this_month', v_total_used,
    'remaining_this_month', greatest(11 - v_total_used, 0),
    'total_seed_count', v_total_seeds,
    'rule_version', 'beta-auto-v1'
  );
end
$$;

revoke all on function public.plant_light_seed_auto_v1(text) from public, anon, authenticated;
grant execute on function public.plant_light_seed_auto_v1(text) to authenticated;

-- Do not leave a public contract that leaks the work Rank or accepts a
-- reader-selected tier after the beta UI cutover.
revoke all on function public.light_seed_status_v2(text) from public, anon, authenticated;
revoke all on function public.plant_light_seed_v2(text, text) from public, anon, authenticated;

commit;
