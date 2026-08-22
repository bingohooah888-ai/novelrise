-- NOVELIGHT LIGHT SEED MVP.
-- Core guarantees:
-- - append-only discovery ledger
-- - 10 seeds per reader per Japan-calendar month
-- - one seed per reader/work lifetime
-- - authors cannot seed their own work
-- - only published, still-unknown works are eligible
-- - paid plans do not affect LIGHT SEED
-- - LIGHT SEED does not modify rankings or ratings

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823083500'));

create table public.light_seed_rules (
  id smallint primary key check (id = 1),
  rule_version text not null,
  monthly_limit integer not null check (monthly_limit between 1 and 100),
  max_pv bigint not null check (max_pv > 0),
  max_favorites integer not null check (max_favorites > 0),
  updated_at timestamptz not null default now()
);

-- These are deliberately beta-tunable operating thresholds, not permanent
-- product promises. We keep them in data rather than hard-coding them into UI.
insert into public.light_seed_rules (
  id,
  rule_version,
  monthly_limit,
  max_pv,
  max_favorites
) values (
  1,
  'beta-v1',
  10,
  1000,
  50
);

revoke all on table public.light_seed_rules from public, anon, authenticated;

create table public.light_seeds (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null,
  novel_id uuid references public.novels(id) on delete set null,
  novel_id_snapshot uuid not null,
  author_id_snapshot uuid not null,
  seeded_at timestamptz not null default now(),
  seed_month date not null,
  pv_at_seed bigint not null check (pv_at_seed >= 0),
  favorites_at_seed integer not null check (favorites_at_seed >= 0),
  rule_version text not null,
  constraint light_seeds_reader_work_unique unique (reader_id, novel_id_snapshot)
);

create index light_seeds_reader_month_idx
  on public.light_seeds (reader_id, seed_month);

create index light_seeds_novel_snapshot_idx
  on public.light_seeds (novel_id_snapshot, seeded_at);

alter table public.light_seeds enable row level security;

revoke all on table public.light_seeds from public, anon, authenticated;
grant select on table public.light_seeds to authenticated;

create policy light_seeds_select_own_history
on public.light_seeds
as permissive
for select
to authenticated
using (
  (select auth.uid()) is not null
  and reader_id = (select auth.uid())
);

create or replace function public.light_seed_status(p_novel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_pv bigint;
  v_favorites integer;
  v_month date := date_trunc('month', timezone('Asia/Tokyo', now()))::date;
  v_monthly_limit integer;
  v_max_pv bigint;
  v_max_favorites integer;
  v_rule_version text;
  v_used integer := 0;
  v_total_seeds bigint := 0;
  v_already_seeded boolean := false;
  v_is_owner boolean := false;
  v_eligible boolean := false;
  v_can_plant boolean := false;
  v_reason text := 'not_published';
begin
  select
    r.monthly_limit,
    r.max_pv,
    r.max_favorites,
    r.rule_version
  into
    v_monthly_limit,
    v_max_pv,
    v_max_favorites,
    v_rule_version
  from public.light_seed_rules r
  where r.id = 1;

  if not found then
    raise exception 'LIGHT SEED rules are not configured';
  end if;

  select n.user_id, coalesce(n.pv, 0)::bigint
  into v_author_id, v_pv
  from public.novels n
  where n.id = p_novel_id
    and n.status = 'published';

  if not found then
    return jsonb_build_object(
      'eligible', false,
      'can_plant', false,
      'reason', 'not_published',
      'monthly_limit', v_monthly_limit,
      'used_this_month', 0,
      'remaining_this_month', v_monthly_limit,
      'already_seeded', false,
      'total_seed_count', 0,
      'rule_version', v_rule_version
    );
  end if;

  select count(*)::integer
  into v_favorites
  from public.favorites f
  where f.novel_id = p_novel_id;

  select count(*)::bigint
  into v_total_seeds
  from public.light_seeds s
  where s.novel_id_snapshot = p_novel_id;

  v_eligible := v_pv < v_max_pv and v_favorites < v_max_favorites;

  if v_uid is null then
    v_reason := case when v_eligible then 'login_required' else 'no_longer_unknown' end;
  else
    select count(*)::integer
    into v_used
    from public.light_seeds s
    where s.reader_id = v_uid
      and s.seed_month = v_month;

    select exists (
      select 1
      from public.light_seeds s
      where s.reader_id = v_uid
        and s.novel_id_snapshot = p_novel_id
    ) into v_already_seeded;

    v_is_owner := v_author_id = v_uid;

    if v_is_owner then
      v_reason := 'own_novel';
    elsif v_already_seeded then
      v_reason := 'already_seeded';
    elsif v_used >= v_monthly_limit then
      v_reason := 'monthly_limit_reached';
    elsif not v_eligible then
      v_reason := 'no_longer_unknown';
    else
      v_reason := 'eligible';
      v_can_plant := true;
    end if;
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'can_plant', v_can_plant,
    'reason', v_reason,
    'monthly_limit', v_monthly_limit,
    'used_this_month', v_used,
    'remaining_this_month', greatest(v_monthly_limit - v_used, 0),
    'already_seeded', v_already_seeded,
    'is_owner', v_is_owner,
    'total_seed_count', v_total_seeds,
    'rule_version', v_rule_version
  );
end
$$;

revoke all on function public.light_seed_status(uuid) from public;
grant execute on function public.light_seed_status(uuid) to anon, authenticated;

create or replace function public.plant_light_seed(p_novel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_pv bigint;
  v_favorites integer;
  v_month date := date_trunc('month', timezone('Asia/Tokyo', now()))::date;
  v_monthly_limit integer;
  v_max_pv bigint;
  v_max_favorites integer;
  v_rule_version text;
  v_used integer;
  v_total_seeds bigint;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'LIGHT SEED requires authentication';
  end if;

  -- Serialize all LIGHT SEED writes for the same reader/month so concurrent
  -- requests cannot race past the monthly allowance.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'novelight:light-seed:' || v_uid::text || ':' || v_month::text,
      0
    )
  );

  select
    r.monthly_limit,
    r.max_pv,
    r.max_favorites,
    r.rule_version
  into
    v_monthly_limit,
    v_max_pv,
    v_max_favorites,
    v_rule_version
  from public.light_seed_rules r
  where r.id = 1;

  if not found then
    raise exception 'LIGHT SEED rules are not configured';
  end if;

  select n.user_id, coalesce(n.pv, 0)::bigint
  into v_author_id, v_pv
  from public.novels n
  where n.id = p_novel_id
    and n.status = 'published'
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Only published works can receive LIGHT SEED';
  end if;

  if v_author_id = v_uid then
    raise exception using
      errcode = '42501',
      message = 'Authors cannot LIGHT SEED their own work';
  end if;

  if exists (
    select 1
    from public.light_seeds s
    where s.reader_id = v_uid
      and s.novel_id_snapshot = p_novel_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'This reader has already LIGHT SEEDED this work';
  end if;

  select count(*)::integer
  into v_used
  from public.light_seeds s
  where s.reader_id = v_uid
    and s.seed_month = v_month;

  if v_used >= v_monthly_limit then
    raise exception using
      errcode = '23514',
      message = format('Monthly LIGHT SEED limit reached (%s)', v_monthly_limit);
  end if;

  select count(*)::integer
  into v_favorites
  from public.favorites f
  where f.novel_id = p_novel_id;

  if v_pv >= v_max_pv or v_favorites >= v_max_favorites then
    raise exception using
      errcode = '23514',
      message = 'This work is no longer eligible as an unknown work';
  end if;

  insert into public.light_seeds (
    reader_id,
    novel_id,
    novel_id_snapshot,
    author_id_snapshot,
    seed_month,
    pv_at_seed,
    favorites_at_seed,
    rule_version
  ) values (
    v_uid,
    p_novel_id,
    p_novel_id,
    v_author_id,
    v_month,
    v_pv,
    v_favorites,
    v_rule_version
  );

  select count(*)::bigint
  into v_total_seeds
  from public.light_seeds s
  where s.novel_id_snapshot = p_novel_id;

  return jsonb_build_object(
    'planted', true,
    'novel_id', p_novel_id,
    'monthly_limit', v_monthly_limit,
    'used_this_month', v_used + 1,
    'remaining_this_month', greatest(v_monthly_limit - v_used - 1, 0),
    'total_seed_count', v_total_seeds,
    'rule_version', v_rule_version
  );
end
$$;

revoke all on function public.plant_light_seed(uuid) from public, anon;
grant execute on function public.plant_light_seed(uuid) to authenticated;

commit;
