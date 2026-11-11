-- FUTURE-ONLY DRAFT; NOT A SUPABASE MIGRATION. DO NOT APPLY TO PRODUCTION/STAGING.
-- NOVELIGHT formal Point exchange + AI direct usage durable transaction tables.
-- OWNER: 10 Scout Point = 1 JPY; gift minimum 30000 Point; beta points
-- may fund approved AI features but may not fund external gift exchange.
--
-- This SQL intentionally DOES NOT seed wallets, issue Points, convert beta
-- balances, set policies, establish exchange providers or enable public APIs.
-- OWNER-approved formal cutover must initialize wallet state from reconciled
-- canonical Point ledger atomically. Without that cutover, no real wallet exists.
-- The private schema must NOT be exposed by the Supabase Data API.

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
      and reserved_points <= 9007199254740991)
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

revoke all on schema novelight_formal_private from public, anon, authenticated;
revoke all on
  novelight_formal_private.scout_point_usage_wallets,
  novelight_formal_private.scout_point_usage_budgets,
  novelight_formal_private.scout_point_usage_operations,
  novelight_formal_private.scout_point_usage_events
  from public, anon, authenticated;
revoke all on sequence
  novelight_formal_private.scout_point_usage_events_event_id_seq
  from public, anon, authenticated;
-- Authorized private server use only. service_role must never be exposed to
-- browser apps. No anon/authenticated policy or public API endpoints created.
grant usage on schema novelight_formal_private to service_role;
grant select,insert,update on
  novelight_formal_private.scout_point_usage_wallets,
  novelight_formal_private.scout_point_usage_budgets,
  novelight_formal_private.scout_point_usage_operations
  to service_role;
grant select,insert on
  novelight_formal_private.scout_point_usage_events to service_role;
grant usage,select on sequence
  novelight_formal_private.scout_point_usage_events_event_id_seq
  to service_role;

-- External provider receipts / AI completion status are *not* inferred
-- from this schema: only independent trusted provider verification may
-- transition a reservation to "committed" or "released".
--
-- Database acceptance, RLS/ACL tests, write-trigger inventory, initial
-- snapshot reconciliation, Point debt/reversal handling, and transactional
-- integration with the existing canonical Point ledger are still required
-- BEFORE any approved live connection. This DRAFT must not be copied to
-- a migration nor used to seed balances without a separate OWNER approval.


-- One-time per-canonical-positive-entry mirror. Formal earning functions
-- call this AFTER inserting a canonical row, in the SAME DB transaction.
-- The private wallet is initialized from a separate OWNER-reviewed 10x
-- cutover; this helper must never auto-seed or convert legacy balances.
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
grant select,insert on novelight_formal_private.scout_point_usage_credit_claims
  to service_role;

create or replace function novelight_formal_private.credit_confirmed_formal_point_draft(
  p_canonical_point_id uuid, p_formal_release_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $formal_point_credit$
declare
  v_point public.scout_point_ledger%rowtype;
  v_wallet novelight_formal_private.scout_point_usage_wallets%rowtype;
  v_inserted uuid;
begin
  if p_canonical_point_id is null or p_formal_release_at is null
     or p_formal_release_at > clock_timestamp() then
    raise exception 'Trusted formal release and canonical Point required';
  end if;
  select * into v_point from public.scout_point_ledger
    where id=p_canonical_point_id and status='confirmed' for update;
  if not found or v_point.point_value <= 0 or
     v_point.occurred_at < p_formal_release_at or
     not (
       v_point.point_kind in ('formal_read_reward','formal_comment_reward') or
       (v_point.point_kind='level_up' and
        v_point.metadata->>'rule_version'='formal-scout-level-100-owner-20261110')
     ) then
    raise exception 'Canonical Point is not an eligible formal issuance';
  end if;
  select * into v_wallet from novelight_formal_private.scout_point_usage_wallets
    where user_id=v_point.user_id for update;
  if not found then
    raise exception 'Formal wallet cutover not initialized';
  end if;
  insert into novelight_formal_private.scout_point_usage_credit_claims(
    canonical_point_id,user_id,amount_points
  ) values(v_point.id,v_point.user_id,v_point.point_value)
  on conflict(canonical_point_id) do nothing
  returning canonical_point_id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('status','already_credited');
  end if;
  update novelight_formal_private.scout_point_usage_wallets
    set available_points=available_points+v_point.point_value,
        exchange_eligible_points=exchange_eligible_points+v_point.point_value,
        revision=revision+1,
        updated_at=now()
    where user_id=v_point.user_id;
  if not found then
    raise exception 'Formal wallet credit not persisted';
  end if;
  return jsonb_build_object('status','credited','amount_points',v_point.point_value);
end
$formal_point_credit$;

revoke all on function
  novelight_formal_private.credit_confirmed_formal_point_draft(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function
  novelight_formal_private.credit_confirmed_formal_point_draft(uuid,timestamptz)
  to service_role;
-- REQUIREMENT: the approved formal cutover must install this draft BEFORE
-- installing formal earning functions and must reconcile the canonical
-- confirmed Point sum with the private wallet opening balance.
-- None of these SQL statements has been executed in any real environment.
