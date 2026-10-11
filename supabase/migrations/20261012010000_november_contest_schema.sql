-- NOVELIGHT November 2026 contest: phase 02 database foundation only.
-- This migration DOES NOT open registration, credit reads, or change ordinary PV.
-- All tables are private. Public and authenticated RPCs are added in later,
-- explicitly ordered workstreams after security review.
-- Never apply to Production without a fresh explicit 本番承認.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261012010000:contest')
);

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'NOVELIGHT contest prerequisites are missing';
  end if;
end
$$;

create table public.novelight_contests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_key text not null unique,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft','registration','active','review','finalized','cancelled')),
  entry_deadline_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  minimum_published_episodes integer not null default 10
    check (minimum_published_episodes >= 10),
  point_thresholds jsonb not null default '{"3":1,"5":3,"10":5}'::jsonb
    check (point_thresholds = '{"3":1,"5":3,"10":5}'::jsonb),
  per_reader_points_cap integer not null default 5
    check (per_reader_points_cap = 5),
  award_rank_limit integer not null default 5 check (award_rank_limit = 5),
  award_amount_yen integer not null default 10000
    check (award_amount_yen = 10000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  check (entry_deadline_at < starts_at and starts_at < ends_at)
);

-- Keep snapshots even if an author later deletes a work/account. The
-- application must verify user ownership and publication against novels/
-- episodes on every enrollment and eligibility-relevant update.
create table public.novelight_contest_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null references public.novelight_contests(id) on delete restrict,
  author_id uuid not null,
  novel_id bigint not null,
  novel_title_snapshot text not null,
  status text not null default 'entered'
    check (status in ('entered','withdrawn','ineligible','disqualified')),
  published_episodes_at_entry integer not null check (published_episodes_at_entry >= 10),
  published_episodes_at_close integer
    check (published_episodes_at_close is null or published_episodes_at_close >= 0),
  entered_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  eligibility_checked_at timestamptz,
  reason_code text,
  unique (contest_id, author_id),
  unique (contest_id, novel_id),
  unique (id, contest_id)
);

create index novelight_contest_entries_by_contest_status
  on public.novelight_contest_entries (contest_id, status, entered_at);

-- Guest identities are pseudonymous contest-scoped credentials. The same
-- person with multiple browser identities cannot be established by cookie
-- alone; later risk checks must quarantine suspected duplicates.
create table public.novelight_contest_readers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null references public.novelight_contests(id) on delete restrict,
  kind text not null check (kind in ('guest','account')),
  user_id uuid,
  guest_key_hash text,
  merged_into_reader_id uuid references public.novelight_contest_readers(id) on delete restrict,
  review_status text not null default 'provisional'
    check (review_status in ('provisional','review_hold','cleared','excluded','merged')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, contest_id),
  check (
    (kind = 'guest' and user_id is null
      and guest_key_hash ~ '^[0-9a-f]{64}$') or
    (kind = 'account' and user_id is not null and guest_key_hash is null)
  ),
  check (merged_into_reader_id is null or merged_into_reader_id <> id)
);

create unique index novelight_contest_readers_account_once
  on public.novelight_contest_readers (contest_id, user_id)
  where user_id is not null;

create unique index novelight_contest_readers_guest_once
  on public.novelight_contest_readers (contest_id, guest_key_hash)
  where guest_key_hash is not null;

create index novelight_contest_readers_review
  on public.novelight_contest_readers (contest_id, review_status, created_at);

-- A server-issued session links one reader + one work + one episode.
-- Do not credit time from browser clocks, or infer identity from IP alone.
create table public.novelight_contest_read_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null,
  reader_id uuid not null,
  entry_id uuid not null,
  episode_id_snapshot bigint not null,
  started_at timestamptz not null default pg_catalog.now(),
  last_heartbeat_at timestamptz not null default pg_catalog.now(),
  last_sequence integer not null default 0 check (last_sequence >= 0),
  foreground_seconds integer not null default 0 check (foreground_seconds >= 0),
  maximum_progress_ratio numeric(5,4) not null default 0
    check (maximum_progress_ratio between 0 and 1),
  interaction_count integer not null default 0 check (interaction_count >= 0),
  status text not null default 'active'
    check (status in ('active','qualified','expired','review_hold','excluded')),
  updated_at timestamptz not null default pg_catalog.now(),
  foreign key (reader_id, contest_id)
    references public.novelight_contest_readers (id, contest_id) on delete restrict,
  foreign key (entry_id, contest_id)
    references public.novelight_contest_entries (id, contest_id) on delete restrict
);

create index novelight_contest_sessions_reader_recent
  on public.novelight_contest_read_sessions (reader_id, started_at desc);
create index novelight_contest_sessions_episode_recent
  on public.novelight_contest_read_sessions (contest_id, episode_id_snapshot, started_at desc);

-- A single verified reader can qualify any given episode only once per contest.
-- Do not add points directly from each heartbeat. Recompute thresholds from
-- DISTINCT qualified episodes. Review_hold does not count as an approved prize.
create table public.novelight_contest_read_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null,
  reader_id uuid not null,
  entry_id uuid not null,
  episode_id_snapshot bigint not null,
  first_session_id uuid references public.novelight_contest_read_sessions(id) on delete restrict,
  qualified_at timestamptz not null default pg_catalog.now(),
  status text not null default 'provisional'
    check (status in ('provisional','accepted','review_hold','excluded')),
  rule_version text not null,
  evidence_summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default pg_catalog.now(),
  foreign key (reader_id, contest_id)
    references public.novelight_contest_readers (id, contest_id) on delete restrict,
  foreign key (entry_id, contest_id)
    references public.novelight_contest_entries (id, contest_id) on delete restrict,
  unique (contest_id, reader_id, episode_id_snapshot)
);

create index novelight_contest_events_by_entry
  on public.novelight_contest_read_events (contest_id, entry_id, status, qualified_at);
create index novelight_contest_events_by_reader
  on public.novelight_contest_read_events (reader_id, entry_id, status);

-- Materialized per-reader score, replace-only (0, 1, 3, 5), never 1+3+5.
create table public.novelight_contest_reader_scores (
  contest_id uuid not null,
  reader_id uuid not null,
  entry_id uuid not null,
  qualified_episode_count integer not null default 0
    check (qualified_episode_count >= 0),
  points integer not null default 0 check (points in (0,1,3,5)),
  review_status text not null default 'provisional'
    check (review_status in ('provisional','review_hold','cleared','excluded')),
  last_recomputed_at timestamptz not null default pg_catalog.now(),
  primary key (contest_id, reader_id, entry_id),
  foreign key (reader_id, contest_id)
    references public.novelight_contest_readers (id, contest_id) on delete restrict,
  foreign key (entry_id, contest_id)
    references public.novelight_contest_entries (id, contest_id) on delete restrict,
  check (
    (qualified_episode_count < 3 and points = 0) or
    (qualified_episode_count between 3 and 4 and points = 1) or
    (qualified_episode_count between 5 and 9 and points = 3) or
    (qualified_episode_count >= 10 and points = 5)
  )
);

create index novelight_contest_reader_scores_entry
  on public.novelight_contest_reader_scores (contest_id, entry_id, review_status, points);

-- Public rankings must be generated as immutable server snapshots, not live
-- provisional leaderboards. The public API will expose only ranked work data.
create table public.novelight_contest_rank_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null references public.novelight_contests(id) on delete restrict,
  cutoff_at timestamptz not null,
  scheduled_publish_at timestamptz not null,
  actual_published_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft','published','retracted')),
  created_at timestamptz not null default pg_catalog.now(),
  unique (contest_id, scheduled_publish_at)
);

create table public.novelight_contest_rank_rows (
  snapshot_id uuid not null references public.novelight_contest_rank_snapshots(id) on delete restrict,
  entry_id uuid not null references public.novelight_contest_entries(id) on delete restrict,
  ordinal_rank integer not null check (ordinal_rank >= 1),
  points bigint not null check (points >= 0),
  qualifying_readers integer not null check (qualifying_readers >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (snapshot_id, entry_id)
);

create index novelight_contest_rank_rows_order
  on public.novelight_contest_rank_rows (snapshot_id, ordinal_rank, points desc);

-- An auditable manual cash transfer, with NO bank account numbers here.
create table public.novelight_contest_awards (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null,
  entry_id uuid not null,
  final_rank integer not null check (final_rank between 1 and 5),
  final_points bigint not null check (final_points >= 0),
  amount_yen integer not null default 10000 check (amount_yen = 10000),
  status text not null default 'pending_review'
    check (status in ('pending_review','on_hold','approved','paid','rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  paid_at timestamptz,
  transfer_reference text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (contest_id, entry_id),
  foreign key (entry_id, contest_id)
    references public.novelight_contest_entries (id, contest_id) on delete restrict,
  check (paid_at is null or status = 'paid')
);

create table public.novelight_contest_review_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  contest_id uuid not null references public.novelight_contests(id) on delete restrict,
  reader_id uuid,
  entry_id uuid,
  actor_user_id uuid,
  action text not null,
  reason_code text,
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (reader_id, contest_id)
    references public.novelight_contest_readers (id, contest_id) on delete restrict,
  foreign key (entry_id, contest_id)
    references public.novelight_contest_entries (id, contest_id) on delete restrict
);

create index novelight_contest_review_audit_recent
  on public.novelight_contest_review_audit (contest_id, created_at desc);

-- All contest data is backend-only at this stage. Future author/reader access
-- must go through tightly scoped RPC/API with role/ownership validation.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'novelight_contests',
    'novelight_contest_entries',
    'novelight_contest_readers',
    'novelight_contest_read_sessions',
    'novelight_contest_read_events',
    'novelight_contest_reader_scores',
    'novelight_contest_rank_snapshots',
    'novelight_contest_rank_rows',
    'novelight_contest_awards',
    'novelight_contest_review_audit'
  ] loop
    execute pg_catalog.format(
      'alter table public.%I enable row level security', table_name
    );
    execute pg_catalog.format(
      'revoke all on table public.%I from public, anon, authenticated', table_name
    );
    execute pg_catalog.format(
      'grant all on table public.%I to service_role', table_name
    );
  end loop;
end
$$;

insert into public.novelight_contests (
  contest_key, title, status, entry_deadline_at, starts_at, ends_at
) values (
  'novelight-november-2026',
  '第1回 NOVELIGHT コンテスト',
  'draft',
  '2026-10-31 14:59:59+00'::timestamptz,
  '2026-10-31 15:00:00+00'::timestamptz,
  '2026-11-30 15:00:00+00'::timestamptz
)
on conflict (contest_key) do nothing;

comment on table public.novelight_contests is
  'Private contest configuration. Draft does not open enrollment or read scoring.';
comment on table public.novelight_contest_entries is
  'One author and one novel per contest. Validate ownership and 10 published episodes server-side.';
comment on table public.novelight_contest_readers is
  'Contest-only private reader identities; a signed guest credential is not human uniqueness proof.';
comment on table public.novelight_contest_read_events is
  'Evidence ledger: distinct episode qualification. Never use raw PV as prize score.';
comment on table public.novelight_contest_awards is
  'Prize decisions. No bank account numbers or payment credentials stored.';

commit;
