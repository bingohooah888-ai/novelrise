-- NOVELIGHT AI Phase 2. Schema only; the global kill switch is OFF.
-- No AI provider, payment, or endpoint is activated by this migration.
begin;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:ai-runtime-v1'));

do $$
begin
  if pg_catalog.to_regclass('public.novels') is null
    or pg_catalog.to_regclass('public.episodes') is null then
    raise exception 'AI foundation requires canonical works and episodes';
  end if;
end
$$;

create table public.novelight_ai_runtime_settings (
  singleton smallint primary key default 1 check (singleton = 1),
  enabled boolean not null default false,
  user_day_cap_micros bigint not null default 0 check (user_day_cap_micros >= 0),
  user_month_cap_micros bigint not null default 0 check (user_month_cap_micros >= 0),
  global_day_cap_micros bigint not null default 0 check (global_day_cap_micros >= 0),
  global_month_cap_micros bigint not null default 0 check (global_month_cap_micros >= 0),
  updated_at timestamptz not null default now()
);

insert into public.novelight_ai_runtime_settings (singleton) values (1);

create table public.novelight_ai_usage_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  work_id bigint references public.novels(id) on delete set null,
  feature_key text not null check (char_length(feature_key) between 1 and 80),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  requested_jst_day date not null default (pg_catalog.timezone('Asia/Tokyo', now()))::date,
  ceiling_micros bigint not null check (ceiling_micros between 1 and 10000000000),
  charged_micros bigint not null default 0 check (charged_micros >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint ai_usage_no_overcharge check (charged_micros <= ceiling_micros),
  constraint ai_usage_settled_status check (
    (status = 'reserved' and settled_at is null)
    or (status = 'settled' and settled_at is not null)
  ),
  unique (actor_id, request_hash, requested_jst_day)
);

create index novelight_ai_usage_actor_day_idx
  on public.novelight_ai_usage_requests (actor_id, requested_jst_day);
create index novelight_ai_usage_jst_day_idx
  on public.novelight_ai_usage_requests (requested_jst_day);

create table public.novelight_ai_usage_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  work_id bigint references public.novels(id) on delete set null,
  feature_key text not null check (char_length(feature_key) between 1 and 80),
  provider text check (provider is null or char_length(provider) <= 80),
  model text check (model is null or char_length(model) <= 120),
  charged_micros bigint not null default 0 check (charged_micros >= 0),
  cache_hit boolean not null default false,
  outcome text not null check (outcome in ('success', 'failed', 'cache_hit')),
  created_at timestamptz not null default now()
);

create index novelight_ai_usage_audit_created_idx
  on public.novelight_ai_usage_audit (created_at desc);

create table public.novelight_ai_bible_facts (
  id bigint generated always as identity primary key,
  novel_id bigint not null references public.novels(id) on delete cascade,
  source_episode_id bigint references public.episodes(id) on delete cascade,
  fact_key text not null check (char_length(fact_key) between 1 and 120),
  fact_kind text not null check (fact_kind in
    ('character', 'relationship', 'location', 'world', 'timeline', 'event', 'foreshadowing', 'other')),
  fact_payload jsonb not null check (jsonb_typeof(fact_payload) = 'object'),
  source_hash text check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$'),
  provenance text not null check (provenance in ('ai_inferred', 'author_confirmed')),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (novel_id, source_episode_id, fact_kind, fact_key)
);

create index novelight_ai_bible_facts_novel_idx
  on public.novelight_ai_bible_facts (novel_id, fact_kind);

create table public.novelight_ai_episode_analysis (
  episode_id bigint primary key references public.episodes(id) on delete cascade,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  revision integer not null default 1 check (revision >= 1),
  analyzed_at timestamptz not null default now()
);

create or replace function public.novelight_ai_fact_source_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.source_episode_id is not null and not exists (
    select 1 from public.episodes e
    where e.id = new.source_episode_id and e.novel_id = new.novel_id
  ) then
    raise exception using errcode = '23514', message = 'AI fact source is outside its novel';
  end if;
  return new;
end
$$;

create trigger ai_fact_source_guard
before insert or update of source_episode_id, novel_id
on public.novelight_ai_bible_facts
for each row execute function public.novelight_ai_fact_source_guard();

-- Privileged PostgREST functions MUST use service_role, never browser JWT.
-- All caps are micro-JPY, pessimistically priced by the server-side router.
create or replace function public.novelight_ai_reserve_usage(
  p_actor_id uuid,
  p_feature_key text,
  p_work_id bigint,
  p_ceiling_micros bigint,
  p_request_hash text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_config public.novelight_ai_runtime_settings%rowtype;
  v_today date := (pg_catalog.timezone('Asia/Tokyo', now()))::date;
  v_user_day bigint;
  v_user_month bigint;
  v_global_day bigint;
  v_global_month bigint;
  v_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'AI service access required';
  end if;
  if p_actor_id is null or p_feature_key is null
    or pg_catalog.char_length(p_feature_key) not between 1 and 80
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_ceiling_micros is null or p_ceiling_micros not between 1 and 10000000000
  then
    raise exception using errcode = '22023', message = 'Invalid AI usage request';
  end if;

  -- Serialized admission across instances: no in-memory billing counters.
  perform pg_catalog.pg_advisory_xact_lock(471927, 20261027);
  select * into v_config from public.novelight_ai_runtime_settings
    where singleton = 1 for update;
  if not found or v_config.enabled is not true then return null; end if;

  if exists (
    select 1 from public.novelight_ai_usage_requests
    where actor_id = p_actor_id and request_hash = p_request_hash
      and requested_jst_day = v_today
  ) then
    return null;
  end if;

  select
    coalesce(sum(case when status = 'reserved' then ceiling_micros else charged_micros end)
      filter (where actor_id = p_actor_id and requested_jst_day = v_today), 0),
    coalesce(sum(case when status = 'reserved' then ceiling_micros else charged_micros end)
      filter (where actor_id = p_actor_id and date_trunc('month', requested_jst_day::timestamp) =
        date_trunc('month', v_today::timestamp)), 0),
    coalesce(sum(case when status = 'reserved' then ceiling_micros else charged_micros end)
      filter (where requested_jst_day = v_today), 0),
    coalesce(sum(case when status = 'reserved' then ceiling_micros else charged_micros end)
      filter (where date_trunc('month', requested_jst_day::timestamp) =
        date_trunc('month', v_today::timestamp)), 0)
  into v_user_day, v_user_month, v_global_day, v_global_month
  from public.novelight_ai_usage_requests
  where requested_jst_day >= date_trunc('month', v_today::timestamp)::date
    and requested_jst_day <= v_today;

  if v_user_day + p_ceiling_micros > v_config.user_day_cap_micros
    or v_user_month + p_ceiling_micros > v_config.user_month_cap_micros
    or v_global_day + p_ceiling_micros > v_config.global_day_cap_micros
    or v_global_month + p_ceiling_micros > v_config.global_month_cap_micros
  then
    return null;
  end if;

  insert into public.novelight_ai_usage_requests (
    actor_id, work_id, feature_key, request_hash, requested_jst_day, ceiling_micros
  ) values (
    p_actor_id, p_work_id, p_feature_key, p_request_hash, v_today, p_ceiling_micros
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.novelight_ai_settle_usage(
  p_reservation_id uuid,
  p_charged_micros bigint
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_reservation public.novelight_ai_usage_requests%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'AI service access required';
  end if;
  if p_reservation_id is null or p_charged_micros is null or p_charged_micros < 0 then
    raise exception using errcode = '22023', message = 'Invalid AI settlement';
  end if;
  select * into v_reservation from public.novelight_ai_usage_requests
    where id = p_reservation_id for update;
  if not found then return false; end if;
  if v_reservation.status = 'settled' then
    return v_reservation.charged_micros = p_charged_micros;
  end if;
  if p_charged_micros > v_reservation.ceiling_micros then
    raise exception using errcode = '22023', message = 'AI settlement exceeds reservation';
  end if;
  update public.novelight_ai_usage_requests
     set status = 'settled',
         charged_micros = p_charged_micros,
         settled_at = now()
   where id = p_reservation_id;
  return true;
end
$$;

-- No public/authenticated access, regardless of RLS configuration.
alter table public.novelight_ai_runtime_settings enable row level security;
alter table public.novelight_ai_usage_requests enable row level security;
alter table public.novelight_ai_usage_audit enable row level security;
alter table public.novelight_ai_bible_facts enable row level security;
alter table public.novelight_ai_episode_analysis enable row level security;

-- Supabase production service_role has BYPASSRLS; these explicit policies
-- also allow its non-BYPASSRLS disposable CI counterpart to exercise the
-- same service-only, fail-closed contract.
create policy ai_service_access on public.novelight_ai_runtime_settings
  for all to service_role using (true) with check (true);
create policy ai_service_access on public.novelight_ai_usage_requests
  for all to service_role using (true) with check (true);
create policy ai_service_access on public.novelight_ai_usage_audit
  for all to service_role using (true) with check (true);
create policy ai_service_access on public.novelight_ai_bible_facts
  for all to service_role using (true) with check (true);
create policy ai_service_access on public.novelight_ai_episode_analysis
  for all to service_role using (true) with check (true);

revoke all on public.novelight_ai_runtime_settings,
  public.novelight_ai_usage_requests, public.novelight_ai_usage_audit,
  public.novelight_ai_bible_facts, public.novelight_ai_episode_analysis
  from public, anon, authenticated;
revoke all on sequence public.novelight_ai_usage_audit_id_seq,
  public.novelight_ai_bible_facts_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.novelight_ai_runtime_settings,
  public.novelight_ai_usage_requests, public.novelight_ai_usage_audit,
  public.novelight_ai_bible_facts, public.novelight_ai_episode_analysis
  to service_role;
grant usage, select on sequence public.novelight_ai_usage_audit_id_seq,
  public.novelight_ai_bible_facts_id_seq to service_role;

revoke all on function public.novelight_ai_fact_source_guard() from public, anon, authenticated;
revoke all on function public.novelight_ai_reserve_usage(uuid, text, bigint, bigint, text)
  from public, anon, authenticated;
revoke all on function public.novelight_ai_settle_usage(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.novelight_ai_reserve_usage(uuid, text, bigint, bigint, text)
  to service_role;
grant execute on function public.novelight_ai_settle_usage(uuid, bigint)
  to service_role;

comment on table public.novelight_ai_runtime_settings is
  'NOVELIGHT AI globally disabled by default; micro-JPY budget controls, no billing activation.';
comment on table public.novelight_ai_usage_requests is
  'Durable, atomic, pessimistic AI budget reservations; no story text stored.';
comment on table public.novelight_ai_bible_facts is
  'Server-only AI candidate facts. Inferred facts are never author-confirmed automatically.';

commit;
