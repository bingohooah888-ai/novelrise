-- NOVELIGHT SCOUT / LIGHT SEED beta event foundations.
--
-- This migration is intentionally additive. It prepares the replayable beta data
-- model required by MASTER chapter 38 without cutting the current public UI over
-- to the new LIGHT SEED contract in the same high-risk database PR.
--
-- Core guarantees introduced here:
-- - work Rank state/history can be recorded independently from LIGHT SEED counts
-- - LIGHT SEED v2 uses GOLD 6 / SILVER 3 / BRONZE 2 monthly inventory
-- - one reader/work lifetime seed uniqueness remains enforced by light_seeds
-- - v2 seed requires at least one valid-read event for the target work
-- - seed type + send-time Rank are persisted for later 180-day discovery replay
-- - valid reading excludes long heartbeat gaps and dedupes reader/episode lifetime
-- - SCOUT event and XP ledgers are append-only, hidden, and idempotent
-- - beta users are not granted direct access to SCOUT XP / Level / badge data

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909071500'));

-- ---------------------------------------------------------------------------
-- Hidden replayable SCOUT event / XP ledgers.
-- ---------------------------------------------------------------------------
create table public.scout_event_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_type text not null,
  event_key text not null unique,
  novel_id_snapshot text,
  episode_id_snapshot text,
  seed_id uuid,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint scout_event_type_length check (char_length(event_type) between 1 and 80),
  constraint scout_event_key_length check (char_length(event_key) between 1 and 240)
);

create index scout_event_user_recent_idx
  on public.scout_event_ledger (user_id, occurred_at desc)
  where user_id is not null;
create index scout_event_novel_recent_idx
  on public.scout_event_ledger (novel_id_snapshot, occurred_at desc)
  where novel_id_snapshot is not null;
create index scout_event_seed_idx
  on public.scout_event_ledger (seed_id)
  where seed_id is not null;

alter table public.scout_event_ledger enable row level security;
revoke all on table public.scout_event_ledger from public, anon, authenticated;

create table public.scout_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_event_id uuid not null references public.scout_event_ledger(id) on delete restrict,
  xp_kind text not null,
  xp_value integer not null,
  rule_version text not null,
  occurred_at timestamptz not null default now(),
  constraint scout_xp_kind_length check (char_length(xp_kind) between 1 and 80),
  constraint scout_xp_reasonable_value check (xp_value between -1000000 and 1000000),
  constraint scout_xp_source_once unique (user_id, source_event_id, xp_kind)
);

create index scout_xp_user_recent_idx
  on public.scout_xp_ledger (user_id, occurred_at desc);

alter table public.scout_xp_ledger enable row level security;
revoke all on table public.scout_xp_ledger from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Work Rank state/history. Rank computation itself is a later PR; all currently
-- published works start at Rank 1 EMBER as the neutral baseline.
-- LIGHT SEED never writes current_rank.
-- ---------------------------------------------------------------------------
create table public.novel_rank_state (
  novel_id_snapshot text primary key,
  author_id_snapshot uuid not null,
  current_rank smallint not null default 1 check (current_rank between 1 and 6),
  peak_rank smallint not null default 1 check (peak_rank between 1 and 6),
  rank_stable_since timestamptz not null default now(),
  last_rank_changed_at timestamptz not null default now(),
  is_completed boolean not null default false,
  completed_at timestamptz,
  final_rank smallint check (final_rank between 1 and 6),
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint novel_rank_peak_not_below_current check (peak_rank >= current_rank),
  constraint novel_rank_final_pair check (
    (final_rank is null and finalized_at is null)
    or (final_rank is not null and finalized_at is not null)
  )
);

alter table public.novel_rank_state enable row level security;
revoke all on table public.novel_rank_state from public, anon, authenticated;

create table public.novel_rank_events (
  id uuid primary key default gen_random_uuid(),
  novel_id_snapshot text not null,
  author_id_snapshot uuid not null,
  from_rank smallint check (from_rank between 1 and 6),
  to_rank smallint not null check (to_rank between 1 and 6),
  event_type text not null check (event_type in ('initial', 'promotion', 'demotion', 'finalized')),
  occurred_at timestamptz not null default now()
);

create index novel_rank_events_novel_recent_idx
  on public.novel_rank_events (novel_id_snapshot, occurred_at desc);

alter table public.novel_rank_events enable row level security;
revoke all on table public.novel_rank_events from public, anon, authenticated;

create or replace function public.novelight_rank_code(p_rank smallint)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case p_rank
    when 1 then 'EMBER'
    when 2 then 'SPARK'
    when 3 then 'GLOW'
    when 4 then 'BEACON'
    when 5 then 'STAR'
    when 6 then 'NOVA'
  end
$$;

revoke all on function public.novelight_rank_code(smallint) from public, anon, authenticated;

create or replace function public.novelight_normalize_rank_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.current_rank is distinct from old.current_rank then
    new.peak_rank := greatest(old.peak_rank, new.current_rank);
    new.last_rank_changed_at := now();
    new.rank_stable_since := now();
  else
    new.peak_rank := greatest(old.peak_rank, new.peak_rank, new.current_rank);
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.novelight_normalize_rank_state() from public, anon, authenticated;

create trigger novel_rank_state_normalize
before update on public.novel_rank_state
for each row
execute function public.novelight_normalize_rank_state();

create or replace function public.novelight_capture_rank_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rank_event_id uuid := gen_random_uuid();
  v_event_type text;
begin
  if new.current_rank is not distinct from old.current_rank then
    return new;
  end if;

  v_event_type := case
    when new.current_rank > old.current_rank then 'promotion'
    else 'demotion'
  end;

  insert into public.novel_rank_events (
    id,
    novel_id_snapshot,
    author_id_snapshot,
    from_rank,
    to_rank,
    event_type,
    occurred_at
  ) values (
    v_rank_event_id,
    new.novel_id_snapshot,
    new.author_id_snapshot,
    old.current_rank,
    new.current_rank,
    v_event_type,
    now()
  );

  insert into public.scout_event_ledger (
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    occurred_at,
    metadata
  ) values (
    null,
    'work_rank_changed',
    'work_rank_changed:' || v_rank_event_id::text,
    new.novel_id_snapshot,
    now(),
    jsonb_build_object(
      'from_rank', old.current_rank,
      'to_rank', new.current_rank,
      'from_code', public.novelight_rank_code(old.current_rank),
      'to_code', public.novelight_rank_code(new.current_rank)
    )
  );

  return new;
end
$$;

revoke all on function public.novelight_capture_rank_change() from public, anon, authenticated;

create trigger novel_rank_state_capture_change
after update of current_rank on public.novel_rank_state
for each row
execute function public.novelight_capture_rank_change();

create or replace function public.novelight_ensure_rank_state_for_published_novel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_created text;
begin
  if new.status <> 'published' then
    return new;
  end if;

  insert into public.novel_rank_state (
    novel_id_snapshot,
    author_id_snapshot,
    current_rank,
    peak_rank
  ) values (
    new.id::text,
    new.user_id,
    1,
    1
  )
  on conflict (novel_id_snapshot) do update
    set author_id_snapshot = excluded.author_id_snapshot,
        updated_at = now()
  returning novel_id_snapshot into v_created;

  if not exists (
    select 1
      from public.novel_rank_events e
     where e.novel_id_snapshot = new.id::text
  ) then
    insert into public.novel_rank_events (
      novel_id_snapshot,
      author_id_snapshot,
      from_rank,
      to_rank,
      event_type
    ) values (
      new.id::text,
      new.user_id,
      null,
      1,
      'initial'
    );
  end if;

  return new;
end
$$;

revoke all on function public.novelight_ensure_rank_state_for_published_novel() from public, anon, authenticated;

create trigger novels_ensure_rank_state
after insert or update of status, user_id on public.novels
for each row
execute function public.novelight_ensure_rank_state_for_published_novel();

insert into public.novel_rank_state (
  novel_id_snapshot,
  author_id_snapshot,
  current_rank,
  peak_rank
)
select n.id::text, n.user_id, 1, 1
from public.novels n
where n.status = 'published'
on conflict (novel_id_snapshot) do nothing;

insert into public.novel_rank_events (
  novel_id_snapshot,
  author_id_snapshot,
  from_rank,
  to_rank,
  event_type
)
select s.novel_id_snapshot, s.author_id_snapshot, null, s.current_rank, 'initial'
from public.novel_rank_state s
where not exists (
  select 1
  from public.novel_rank_events e
  where e.novel_id_snapshot = s.novel_id_snapshot
);

-- ---------------------------------------------------------------------------
-- Valid reading. Raw session state and qualification events stay private.
-- A reader/episode can qualify only once, preventing mechanical rereads from
-- multiplying the replayable activity ledger.
-- ---------------------------------------------------------------------------
create table public.valid_read_rules (
  id smallint primary key check (id = 1),
  rule_version text not null,
  normal_min_chars integer not null check (normal_min_chars > 0),
  normal_progress_ratio double precision not null check (normal_progress_ratio > 0 and normal_progress_ratio <= 1),
  short_progress_ratio double precision not null check (short_progress_ratio > 0 and short_progress_ratio <= 1),
  normal_foreground_seconds integer not null check (normal_foreground_seconds > 0),
  min_short_foreground_seconds integer not null check (min_short_foreground_seconds > 0),
  interaction_events integer not null check (interaction_events > 0),
  max_heartbeat_gap_seconds integer not null check (max_heartbeat_gap_seconds between 5 and 120),
  max_sessions_per_hour integer not null check (max_sessions_per_hour between 1 and 500),
  updated_at timestamptz not null default now()
);

insert into public.valid_read_rules (
  id,
  rule_version,
  normal_min_chars,
  normal_progress_ratio,
  short_progress_ratio,
  normal_foreground_seconds,
  min_short_foreground_seconds,
  interaction_events,
  max_heartbeat_gap_seconds,
  max_sessions_per_hour
) values (
  1,
  'beta-v1',
  800,
  0.40,
  0.80,
  60,
  10,
  3,
  20,
  30
);

revoke all on table public.valid_read_rules from public, anon, authenticated;

create table public.valid_read_sessions (
  reader_id uuid not null,
  session_id uuid not null,
  novel_id_snapshot text not null,
  episode_id_snapshot text not null,
  author_id_snapshot uuid not null,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  foreground_seconds integer not null default 0 check (foreground_seconds >= 0),
  max_progress_ratio double precision not null default 0 check (max_progress_ratio between 0 and 1),
  interaction_count integer not null default 0 check (interaction_count >= 0),
  last_client_seq integer not null default 0 check (last_client_seq >= 0),
  body_char_count integer not null check (body_char_count >= 0),
  qualified_at timestamptz,
  primary key (reader_id, session_id)
);

create index valid_read_sessions_reader_recent_idx
  on public.valid_read_sessions (reader_id, started_at desc);
create index valid_read_sessions_episode_idx
  on public.valid_read_sessions (episode_id_snapshot, started_at desc);

alter table public.valid_read_sessions enable row level security;
revoke all on table public.valid_read_sessions from public, anon, authenticated;

create table public.valid_read_events (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null,
  novel_id_snapshot text not null,
  episode_id_snapshot text not null,
  author_id_snapshot uuid not null,
  session_id uuid not null,
  qualified_at timestamptz not null default now(),
  body_char_count integer not null check (body_char_count >= 0),
  progress_signal boolean not null,
  foreground_signal boolean not null,
  interaction_signal boolean not null,
  rule_version text not null,
  constraint valid_read_reader_episode_once unique (reader_id, episode_id_snapshot)
);

create index valid_read_reader_novel_idx
  on public.valid_read_events (reader_id, novel_id_snapshot, qualified_at desc);
create index valid_read_novel_recent_idx
  on public.valid_read_events (novel_id_snapshot, qualified_at desc);

alter table public.valid_read_events enable row level security;
revoke all on table public.valid_read_events from public, anon, authenticated;

create or replace function public.record_valid_read_progress(
  p_episode_id text,
  p_session_id uuid,
  p_progress_ratio double precision,
  p_interaction_count integer,
  p_client_seq integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id text;
  v_author_id uuid;
  v_body_chars integer;
  v_rule public.valid_read_rules%rowtype;
  v_session public.valid_read_sessions%rowtype;
  v_gap_seconds integer := 0;
  v_credit_seconds integer := 0;
  v_progress_threshold double precision;
  v_foreground_threshold integer;
  v_progress_signal boolean := false;
  v_foreground_signal boolean := false;
  v_interaction_signal boolean := false;
  v_signal_count integer := 0;
  v_existing boolean := false;
  v_event_id uuid;
  v_newly_qualified boolean := false;
  v_recent_sessions integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_episode_id is null or btrim(p_episode_id) = '' or p_session_id is null then
    raise exception using errcode = '22023', message = 'Valid episode and session identifiers are required';
  end if;

  if p_progress_ratio is null or p_progress_ratio < 0 or p_progress_ratio > 1
     or p_interaction_count is null or p_interaction_count < 0 or p_interaction_count > 10000
     or p_client_seq is null or p_client_seq < 0 or p_client_seq > 1000000 then
    raise exception using errcode = '22023', message = 'Reading progress payload is invalid';
  end if;

  select
    e.novel_id::text,
    e.user_id,
    char_length(coalesce(e.content, ''))::integer
  into
    v_novel_id,
    v_author_id,
    v_body_chars
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id::text = p_episode_id
    and e.status = 'published'
    and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = 'Published episode is required';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = 'Own-work reading cannot qualify';
  end if;

  select exists (
    select 1
    from public.valid_read_events e
    where e.reader_id = v_uid
      and e.episode_id_snapshot = p_episode_id
  ) into v_existing;

  if v_existing then
    return jsonb_build_object('qualified', true, 'newly_qualified', false);
  end if;

  select * into v_rule
  from public.valid_read_rules
  where id = 1;

  if not found then
    raise exception 'Valid-read rules are not configured';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'novelight:valid-read:' || v_uid::text || ':' || p_session_id::text,
      0
    )
  );

  select * into v_session
  from public.valid_read_sessions s
  where s.reader_id = v_uid
    and s.session_id = p_session_id
  for update;

  if not found then
    select count(*)::integer into v_recent_sessions
    from public.valid_read_sessions s
    where s.reader_id = v_uid
      and s.started_at >= now() - interval '1 hour';

    if v_recent_sessions >= v_rule.max_sessions_per_hour then
      raise exception using errcode = 'P0001', message = 'Reading session rate limit reached';
    end if;

    insert into public.valid_read_sessions (
      reader_id,
      session_id,
      novel_id_snapshot,
      episode_id_snapshot,
      author_id_snapshot,
      foreground_seconds,
      max_progress_ratio,
      interaction_count,
      last_client_seq,
      body_char_count
    ) values (
      v_uid,
      p_session_id,
      v_novel_id,
      p_episode_id,
      v_author_id,
      0,
      p_progress_ratio,
      p_interaction_count,
      p_client_seq,
      v_body_chars
    )
    returning * into v_session;
  else
    if v_session.episode_id_snapshot <> p_episode_id
       or v_session.novel_id_snapshot <> v_novel_id then
      raise exception using errcode = '22023', message = 'Reading session cannot change episode';
    end if;

    if p_client_seq > v_session.last_client_seq then
      v_gap_seconds := floor(extract(epoch from (now() - v_session.last_heartbeat_at)))::integer;
      if v_gap_seconds between 1 and v_rule.max_heartbeat_gap_seconds then
        v_credit_seconds := v_gap_seconds;
      else
        v_credit_seconds := 0;
      end if;

      update public.valid_read_sessions
      set foreground_seconds = foreground_seconds + v_credit_seconds,
          max_progress_ratio = greatest(max_progress_ratio, p_progress_ratio),
          interaction_count = greatest(interaction_count, p_interaction_count),
          last_client_seq = p_client_seq,
          last_heartbeat_at = now()
      where reader_id = v_uid
        and session_id = p_session_id
      returning * into v_session;
    end if;
  end if;

  if v_session.body_char_count < v_rule.normal_min_chars then
    v_progress_threshold := v_rule.short_progress_ratio;
    v_foreground_threshold := greatest(
      v_rule.min_short_foreground_seconds,
      ceil(
        v_rule.normal_foreground_seconds::numeric
        * greatest(v_session.body_char_count, 1)::numeric
        / v_rule.normal_min_chars::numeric
      )::integer
    );
    v_foreground_threshold := least(v_foreground_threshold, v_rule.normal_foreground_seconds);
  else
    v_progress_threshold := v_rule.normal_progress_ratio;
    v_foreground_threshold := v_rule.normal_foreground_seconds;
  end if;

  v_progress_signal := v_session.max_progress_ratio >= v_progress_threshold;
  v_foreground_signal := v_session.foreground_seconds >= v_foreground_threshold;
  v_interaction_signal := v_session.interaction_count >= v_rule.interaction_events;

  v_signal_count :=
      case when v_progress_signal then 1 else 0 end
    + case when v_foreground_signal then 1 else 0 end
    + case when v_interaction_signal then 1 else 0 end;

  if v_signal_count >= 2 then
    insert into public.valid_read_events (
      reader_id,
      novel_id_snapshot,
      episode_id_snapshot,
      author_id_snapshot,
      session_id,
      body_char_count,
      progress_signal,
      foreground_signal,
      interaction_signal,
      rule_version
    ) values (
      v_uid,
      v_novel_id,
      p_episode_id,
      v_author_id,
      p_session_id,
      v_session.body_char_count,
      v_progress_signal,
      v_foreground_signal,
      v_interaction_signal,
      v_rule.rule_version
    )
    on conflict (reader_id, episode_id_snapshot) do nothing
    returning id into v_event_id;

    v_newly_qualified := v_event_id is not null;

    if v_newly_qualified then
      update public.valid_read_sessions
      set qualified_at = now()
      where reader_id = v_uid
        and session_id = p_session_id;

      insert into public.scout_event_ledger (
        user_id,
        event_type,
        event_key,
        novel_id_snapshot,
        episode_id_snapshot,
        occurred_at,
        metadata
      ) values (
        v_uid,
        'valid_read',
        'valid_read:' || v_uid::text || ':' || p_episode_id,
        v_novel_id,
        p_episode_id,
        now(),
        jsonb_build_object(
          'valid_read_event_id', v_event_id,
          'rule_version', v_rule.rule_version
        )
      )
      on conflict (event_key) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'qualified', v_signal_count >= 2 or v_existing,
    'newly_qualified', v_newly_qualified
  );
end
$$;

revoke all on function public.record_valid_read_progress(text, uuid, double precision, integer, integer) from public, anon;
grant execute on function public.record_valid_read_progress(text, uuid, double precision, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly LIGHT SEED inventory and v2 send-time snapshots.
-- Existing v1 rows remain valid legacy history; they are counted against the
-- v2 monthly total if both contracts coexist during the staged cutover.
-- ---------------------------------------------------------------------------
create table public.light_seed_monthly_inventory (
  user_id uuid not null,
  seed_month date not null,
  gold_allocated integer not null default 6 check (gold_allocated = 6),
  silver_allocated integer not null default 3 check (silver_allocated = 3),
  bronze_allocated integer not null default 2 check (bronze_allocated = 2),
  gold_used integer not null default 0 check (gold_used between 0 and 6),
  silver_used integer not null default 0 check (silver_used between 0 and 3),
  bronze_used integer not null default 0 check (bronze_used between 0 and 2),
  legacy_used integer not null default 0 check (legacy_used between 0 and 11),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, seed_month),
  constraint light_seed_inventory_total_used check (
    gold_used + silver_used + bronze_used + legacy_used <= 11
  )
);

alter table public.light_seed_monthly_inventory enable row level security;
revoke all on table public.light_seed_monthly_inventory from public, anon, authenticated;

create or replace function public.novelight_ensure_light_seed_inventory(
  p_user_id uuid,
  p_seed_month date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_gold integer := 0;
  v_silver integer := 0;
  v_bronze integer := 0;
  v_legacy integer := 0;
begin
  if p_user_id is null or p_seed_month is null then
    raise exception using errcode = '22023', message = 'Inventory owner and month are required';
  end if;

  if exists (
    select 1
    from public.light_seed_monthly_inventory i
    where i.user_id = p_user_id
      and i.seed_month = p_seed_month
  ) then
    return;
  end if;

  select
    count(*) filter (where s.seed_type = 'GOLD')::integer,
    count(*) filter (where s.seed_type = 'SILVER')::integer,
    count(*) filter (where s.seed_type = 'BRONZE')::integer,
    count(*) filter (where s.seed_type is null)::integer
  into v_gold, v_silver, v_bronze, v_legacy
  from public.light_seeds s
  where s.reader_id = p_user_id
    and s.seed_month = p_seed_month;

  if v_gold > 6 or v_silver > 3 or v_bronze > 2
     or v_gold + v_silver + v_bronze + v_legacy > 11 then
    raise exception 'Existing LIGHT SEED history exceeds beta-v2 inventory limits';
  end if;

  insert into public.light_seed_monthly_inventory (
    user_id,
    seed_month,
    gold_used,
    silver_used,
    bronze_used,
    legacy_used
  ) values (
    p_user_id,
    p_seed_month,
    v_gold,
    v_silver,
    v_bronze,
    v_legacy
  )
  on conflict (user_id, seed_month) do nothing;
end
$$;

revoke all on function public.novelight_ensure_light_seed_inventory(uuid, date) from public, anon, authenticated;

alter table public.light_seeds
  add column seed_type text,
  add column rank_at_seed smallint,
  add column rank_code_at_seed text,
  add column valid_read_event_id uuid;

alter table public.light_seeds
  add constraint light_seeds_seed_type_check
    check (seed_type is null or seed_type in ('GOLD', 'SILVER', 'BRONZE')),
  add constraint light_seeds_rank_at_seed_check
    check (rank_at_seed is null or rank_at_seed between 1 and 6),
  add constraint light_seeds_rank_code_check
    check (
      rank_code_at_seed is null
      or rank_code_at_seed in ('EMBER', 'SPARK', 'GLOW', 'BEACON', 'STAR', 'NOVA')
    );

create table public.seed_discovery_state (
  seed_id uuid primary key,
  reader_id uuid not null,
  novel_id_snapshot text not null,
  seed_type text check (seed_type in ('GOLD', 'SILVER', 'BRONZE')),
  rank_at_seed smallint not null check (rank_at_seed between 1 and 6),
  highest_rank_seen smallint not null check (highest_rank_seen between 1 and 6),
  best_rank_delta smallint not null default 0 check (best_rank_delta between 0 and 5),
  cumulative_discovery_xp integer not null default 0 check (cumulative_discovery_xp >= 0),
  window_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index seed_discovery_window_idx
  on public.seed_discovery_state (window_expires_at, novel_id_snapshot);

alter table public.seed_discovery_state enable row level security;
revoke all on table public.seed_discovery_state from public, anon, authenticated;

create or replace function public.novelight_snapshot_light_seed_rank()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rank smallint;
  v_author uuid;
begin
  if new.rank_at_seed is not null then
    return new;
  end if;

  select n.user_id into v_author
  from public.novels n
  where n.id::text = new.novel_id_snapshot
    and n.status = 'published';

  if v_author is null then
    return new;
  end if;

  insert into public.novel_rank_state (
    novel_id_snapshot,
    author_id_snapshot,
    current_rank,
    peak_rank
  ) values (
    new.novel_id_snapshot,
    v_author,
    1,
    1
  )
  on conflict (novel_id_snapshot) do nothing;

  select s.current_rank into v_rank
  from public.novel_rank_state s
  where s.novel_id_snapshot = new.novel_id_snapshot;

  new.rank_at_seed := v_rank;
  new.rank_code_at_seed := public.novelight_rank_code(v_rank);
  return new;
end
$$;

revoke all on function public.novelight_snapshot_light_seed_rank() from public, anon, authenticated;

create trigger light_seeds_snapshot_rank
before insert on public.light_seeds
for each row
execute function public.novelight_snapshot_light_seed_rank();

create or replace function public.novelight_capture_light_seed_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid;
  v_xp integer;
begin
  insert into public.scout_event_ledger (
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    seed_id,
    occurred_at,
    metadata
  ) values (
    new.reader_id,
    'light_seed_sent',
    'light_seed_sent:' || new.id::text,
    new.novel_id_snapshot,
    new.id,
    new.seeded_at,
    jsonb_strip_nulls(jsonb_build_object(
      'seed_type', new.seed_type,
      'rank_at_seed', new.rank_at_seed,
      'rank_code_at_seed', new.rank_code_at_seed,
      'legacy_contract', new.seed_type is null
    ))
  )
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.scout_event_ledger e
    where e.event_key = 'light_seed_sent:' || new.id::text;
  end if;

  if new.seed_type is not null then
    v_xp := case new.seed_type
      when 'GOLD' then 30
      when 'SILVER' then 20
      when 'BRONZE' then 10
    end;

    insert into public.scout_xp_ledger (
      user_id,
      source_event_id,
      xp_kind,
      xp_value,
      rule_version,
      occurred_at
    ) values (
      new.reader_id,
      v_event_id,
      'light_seed_use',
      v_xp,
      'beta-v1',
      new.seeded_at
    )
    on conflict (user_id, source_event_id, xp_kind) do nothing;

    if new.rank_at_seed is not null then
      insert into public.seed_discovery_state (
        seed_id,
        reader_id,
        novel_id_snapshot,
        seed_type,
        rank_at_seed,
        highest_rank_seen,
        window_expires_at
      ) values (
        new.id,
        new.reader_id,
        new.novel_id_snapshot,
        new.seed_type,
        new.rank_at_seed,
        new.rank_at_seed,
        new.seeded_at + interval '180 days'
      )
      on conflict (seed_id) do nothing;
    end if;
  else
    update public.light_seed_monthly_inventory
    set legacy_used = legacy_used + 1,
        updated_at = now()
    where user_id = new.reader_id
      and seed_month = new.seed_month
      and gold_used + silver_used + bronze_used + legacy_used < 11;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_capture_light_seed_event() from public, anon, authenticated;

create trigger light_seeds_capture_scout_event
after insert on public.light_seeds
for each row
execute function public.novelight_capture_light_seed_event();

-- Backfill only event snapshots for pre-existing LIGHT SEED history. Historical
-- rows have no invented seed type or valid-read proof.
insert into public.scout_event_ledger (
  user_id,
  event_type,
  event_key,
  novel_id_snapshot,
  seed_id,
  occurred_at,
  metadata
)
select
  s.reader_id,
  'light_seed_sent',
  'light_seed_sent:' || s.id::text,
  s.novel_id_snapshot,
  s.id,
  s.seeded_at,
  jsonb_build_object(
    'rank_at_seed', s.rank_at_seed,
    'rank_code_at_seed', s.rank_code_at_seed,
    'legacy_contract', true
  )
from public.light_seeds s
on conflict (event_key) do nothing;

-- ---------------------------------------------------------------------------
-- LIGHT SEED v2 RPCs. The existing v1 RPC remains available until a follow-up
-- UI cutover PR so this migration can be merged/deployed without an outage.
-- The follow-up cutover must revoke/remove v1 before beta data collection starts.
-- ---------------------------------------------------------------------------
create or replace function public.light_seed_status_v2(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_rank smallint;
  v_month date := date_trunc('month', timezone('Asia/Tokyo', now()))::date;
  v_inventory public.light_seed_monthly_inventory%rowtype;
  v_already_seeded boolean := false;
  v_has_valid_read boolean := false;
  v_is_owner boolean := false;
  v_total_seeds bigint := 0;
  v_total_used integer := 0;
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
      'total_seed_count', 0
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
      'total_seed_count', 0
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

  select count(*)::bigint into v_total_seeds
  from public.light_seeds s
  where s.novel_id_snapshot = p_novel_id;

  if v_uid is null then
    v_reason := 'login_required';
    return jsonb_build_object(
      'eligible', true,
      'can_plant', false,
      'reason', v_reason,
      'monthly_limit', 11,
      'remaining_this_month', 11,
      'gold_remaining', 6,
      'silver_remaining', 3,
      'bronze_remaining', 2,
      'already_seeded', false,
      'has_valid_read', false,
      'total_seed_count', v_total_seeds,
      'work_rank', v_rank,
      'work_rank_code', public.novelight_rank_code(v_rank),
      'rule_version', 'beta-v2'
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
    'gold_remaining', greatest(6 - v_inventory.gold_used, 0),
    'silver_remaining', greatest(3 - v_inventory.silver_used, 0),
    'bronze_remaining', greatest(2 - v_inventory.bronze_used, 0),
    'already_seeded', v_already_seeded,
    'has_valid_read', v_has_valid_read,
    'is_owner', v_is_owner,
    'total_seed_count', v_total_seeds,
    'work_rank', v_rank,
    'work_rank_code', public.novelight_rank_code(v_rank),
    'rule_version', 'beta-v2'
  );
end
$$;

revoke all on function public.light_seed_status_v2(text) from public;
grant execute on function public.light_seed_status_v2(text) to anon, authenticated;

create or replace function public.plant_light_seed_v2(
  p_novel_id text,
  p_seed_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_seed_type text := upper(btrim(coalesce(p_seed_type, '')));
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

  if v_seed_type not in ('GOLD', 'SILVER', 'BRONZE') then
    raise exception using errcode = '22023', message = 'LIGHT SEED type must be GOLD, SILVER, or BRONZE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('novelight:light-seed-v2:' || v_uid::text || ':' || v_month::text, 0)
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
    raise exception using errcode = '23514', message = 'Selected LIGHT SEED type is exhausted';
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
    'beta-v2',
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
    'rank_at_seed', v_rank,
    'rank_code_at_seed', v_rank_code,
    'monthly_limit', 11,
    'used_this_month', v_total_used,
    'remaining_this_month', greatest(11 - v_total_used, 0),
    'gold_remaining', greatest(6 - v_inventory.gold_used, 0),
    'silver_remaining', greatest(3 - v_inventory.silver_used, 0),
    'bronze_remaining', greatest(2 - v_inventory.bronze_used, 0),
    'total_seed_count', v_total_seeds,
    'rule_version', 'beta-v2'
  );
end
$$;

revoke all on function public.plant_light_seed_v2(text, text) from public, anon;
grant execute on function public.plant_light_seed_v2(text, text) to authenticated;

commit;