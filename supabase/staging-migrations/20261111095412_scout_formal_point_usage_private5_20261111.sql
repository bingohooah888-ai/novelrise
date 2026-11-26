-- NOVELIGHT SCOUT Point usage: Staging-only five-table schema bootstrap.
-- Source: docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql
-- OWNER approval required before executing. Do NOT run on Production.
-- One migration / one execution. No balances, Point issuance, server wiring,
-- credential setup, grants, functions, triggers, API exposure or public release.
-- Existing LEVEL tables/functions and existing schema-wide privileges are untouched.
-- Run via the existing Supabase migration operation (atomic transaction).
-- IMPORTANT: service_role is NOLOGIN and BYPASSRLS on observed Staging;
-- the formal pg-compatible application server currently has NO bound DB login.
-- Therefore, no data privileges are granted to ANY application role here.

create schema if not exists novelight_formal_private;

create table if not exists novelight_formal_private.scout_point_usage_wallets (
  user_id uuid primary key references auth.users(id) on delete restrict,
  available_points bigint not null default 0 check (available_points >= 0),
  exchange_eligible_points bigint not null default 0
    check (exchange_eligible_points >= 0),
  reserved_points bigint not null default 0 check (reserved_points >= 0),
  held_points bigint not null default 0 check (held_points >= 0),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint scout_usage_eligible_subset
    check (exchange_eligible_points <= available_points),
  constraint scout_usage_int_safe
    check (available_points <= 9007199254740991
      and exchange_eligible_points <= 9007199254740991
      and reserved_points <= 9007199254740991
      and held_points <= 9007199254740991)
);

create table if not exists novelight_formal_private.scout_point_usage_budgets (
  purpose text primary key
    check (purpose in ('external_exchange', 'ai_direct_use')),
  scope_id text not null unique,
  limit_points bigint not null check (limit_points >= 0),
  committed_points bigint not null default 0 check (committed_points >= 0),
  reserved_points bigint not null default 0 check (reserved_points >= 0),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint scout_usage_budget_bound
    check (committed_points + reserved_points <= limit_points),
  constraint scout_usage_budget_safe
    check (limit_points <= 9007199254740991)
);

create table if not exists novelight_formal_private.scout_point_usage_operations (
  operation_id uuid primary key,
  user_id uuid not null references
    novelight_formal_private.scout_point_usage_wallets(user_id),
  purpose text not null check (purpose in ('external_exchange','ai_direct_use')),
  amount_points bigint not null check (amount_points > 0),
  phase text not null check (phase in ('reserved','committed','released','refunded')),
  feature_id text,
  eligible_reserved_points bigint not null default 0
    check (eligible_reserved_points >= 0),
  revision bigint not null check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_usage_operation_allocation
    check (eligible_reserved_points <= amount_points),
  constraint scout_usage_exchange_floor
    check (purpose <> 'external_exchange' or amount_points >= 30000),
  constraint scout_usage_exchange_full_eligibility
    check (purpose <> 'external_exchange'
      or eligible_reserved_points = amount_points),
  constraint scout_usage_ai_feature
    check ((purpose = 'ai_direct_use' and feature_id is not null)
      or (purpose = 'external_exchange' and feature_id is null))
);
create index if not exists scout_usage_op_pending
  on novelight_formal_private.scout_point_usage_operations
  (created_at) where purpose='external_exchange' and phase='reserved';
create index if not exists scout_usage_op_user
  on novelight_formal_private.scout_point_usage_operations
  (user_id,created_at desc);

-- Every state transition is appended, never updated by the app.
-- A committed/released/refunded operation must not acquire a second
-- incompatible transition; service + row lock + revision enforce phase order.
-- Canonical point usage debits and refunds are appended to public.scout_point_ledger
-- within the same private transaction only after independently verified
-- fulfillment or funds recovery. Reservation never creates a canonical debit.
create table if not exists novelight_formal_private.scout_point_usage_events (
  event_id bigint generated always as identity primary key,
  operation_id uuid not null references
    novelight_formal_private.scout_point_usage_operations(operation_id),
  user_id uuid not null references auth.users(id) on delete restrict,
  purpose text not null check (purpose in ('external_exchange','ai_direct_use')),
  phase text not null check (phase in ('reserved','committed','released','refunded')),
  amount_points bigint not null check (amount_points > 0),
  feature_id text,
  created_at timestamptz not null default now(),
  unique (operation_id, phase)
);
create index if not exists scout_usage_event_user
  on novelight_formal_private.scout_point_usage_events
  (user_id,created_at desc);

alter table novelight_formal_private.scout_point_usage_wallets
  enable row level security;
alter table novelight_formal_private.scout_point_usage_budgets
  enable row level security;
alter table novelight_formal_private.scout_point_usage_operations
  enable row level security;
alter table novelight_formal_private.scout_point_usage_events
  enable row level security;

create table if not exists novelight_formal_private.scout_point_usage_credit_claims (
  canonical_point_id uuid primary key references public.scout_point_ledger(id)
    on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_points integer not null check (amount_points > 0),
  credited_at timestamptz not null default now()
);
alter table novelight_formal_private.scout_point_usage_credit_claims
  enable row level security;
revoke all on novelight_formal_private.scout_point_usage_credit_claims
  from public,anon,authenticated;

-- Only the five new tables and their identity sequence receive ACL changes.
-- Do NOT REVOKE on the shared private schema: existing LEVEL uses it.
create index if not exists scout_usage_credit_claim_user
  on novelight_formal_private.scout_point_usage_credit_claims
  (user_id, credited_at desc);

revoke all on table
  novelight_formal_private.scout_point_usage_wallets,
  novelight_formal_private.scout_point_usage_budgets,
  novelight_formal_private.scout_point_usage_operations,
  novelight_formal_private.scout_point_usage_events,
  novelight_formal_private.scout_point_usage_credit_claims
  from public, anon, authenticated, service_role;
revoke all on sequence
  novelight_formal_private.scout_point_usage_events_event_id_seq
  from public, anon, authenticated, service_role;

-- Five-table bootstrap only. Future earning/credit functions remain dormant.
-- The eventual trusted server DB LOGIN/SET ROLE and least-privilege grants
-- must be identified and approved with actual server connection wiring.
