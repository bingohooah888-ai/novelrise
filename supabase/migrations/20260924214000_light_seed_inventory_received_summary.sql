-- Expose authenticated LIGHT SEED inventory and owner-only received summaries.
-- Read-only RPCs only. No stored LIGHT SEED evidence or allocations are mutated.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260924214000'));

create or replace function public.novelight_light_seed_inventory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_month date := pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('Asia/Tokyo', pg_catalog.now())
  )::date;
  v_gold_allocated integer := 6;
  v_silver_allocated integer := 3;
  v_bronze_allocated integer := 2;
  v_gold_used integer := 0;
  v_silver_used integer := 0;
  v_bronze_used integer := 0;
  v_legacy_used integer := 0;
  v_total_used integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select
    i.gold_allocated,
    i.silver_allocated,
    i.bronze_allocated,
    i.gold_used,
    i.silver_used,
    i.bronze_used,
    i.legacy_used
  into
    v_gold_allocated,
    v_silver_allocated,
    v_bronze_allocated,
    v_gold_used,
    v_silver_used,
    v_bronze_used,
    v_legacy_used
  from public.light_seed_monthly_inventory i
  where i.user_id = v_uid
    and i.seed_month = v_month;

  v_total_used :=
    coalesce(v_gold_used, 0)
    + coalesce(v_silver_used, 0)
    + coalesce(v_bronze_used, 0)
    + coalesce(v_legacy_used, 0);

  return pg_catalog.jsonb_build_object(
    'seed_month', v_month,
    'monthly_limit',
      coalesce(v_gold_allocated, 6)
      + coalesce(v_silver_allocated, 3)
      + coalesce(v_bronze_allocated, 2),
    'used_this_month', v_total_used,
    'remaining_this_month', greatest(
      coalesce(v_gold_allocated, 6)
      + coalesce(v_silver_allocated, 3)
      + coalesce(v_bronze_allocated, 2)
      - v_total_used,
      0
    ),
    'gold_allocated', coalesce(v_gold_allocated, 6),
    'silver_allocated', coalesce(v_silver_allocated, 3),
    'bronze_allocated', coalesce(v_bronze_allocated, 2),
    'gold_remaining', greatest(coalesce(v_gold_allocated, 6) - coalesce(v_gold_used, 0), 0),
    'silver_remaining', greatest(coalesce(v_silver_allocated, 3) - coalesce(v_silver_used, 0), 0),
    'bronze_remaining', greatest(coalesce(v_bronze_allocated, 2) - coalesce(v_bronze_used, 0), 0),
    'legacy_used', coalesce(v_legacy_used, 0),
    'rule_version', 'beta-v2'
  );
end
$$;

revoke all on function public.novelight_light_seed_inventory()
  from public, anon;
grant execute on function public.novelight_light_seed_inventory()
  to authenticated;

create or replace function public.novelight_author_received_light_seed_summary(
  p_novel_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_total bigint := 0;
  v_gold bigint := 0;
  v_silver bigint := 0;
  v_bronze bigint := 0;
  v_legacy bigint := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_novel_id is null or pg_catalog.btrim(p_novel_id) = '' then
    raise exception using errcode = '22023', message = 'A valid novel identifier is required';
  end if;

  select n.user_id
  into v_author_id
  from public.novels n
  where n.id::text = p_novel_id;

  if not found then
    raise exception using errcode = '23514', message = 'Novel not found';
  end if;

  if v_author_id is distinct from v_uid then
    raise exception using errcode = '42501', message = 'Only the work owner can view received LIGHT SEED breakdown';
  end if;

  select
    count(*)::bigint,
    count(*) filter (where s.seed_type = 'GOLD')::bigint,
    count(*) filter (where s.seed_type = 'SILVER')::bigint,
    count(*) filter (where s.seed_type = 'BRONZE')::bigint,
    count(*) filter (
      where s.seed_type is null
         or s.seed_type not in ('GOLD', 'SILVER', 'BRONZE')
    )::bigint
  into
    v_total,
    v_gold,
    v_silver,
    v_bronze,
    v_legacy
  from public.light_seeds s
  where s.novel_id_snapshot = p_novel_id
    and s.author_id_snapshot = v_uid;

  return pg_catalog.jsonb_build_object(
    'novel_id', p_novel_id,
    'total_seed_count', v_total,
    'gold_count', v_gold,
    'silver_count', v_silver,
    'bronze_count', v_bronze,
    'legacy_count', v_legacy,
    'rule_version', 'beta-v2'
  );
end
$$;

revoke all on function public.novelight_author_received_light_seed_summary(text)
  from public, anon;
grant execute on function public.novelight_author_received_light_seed_summary(text)
  to authenticated;

commit;
