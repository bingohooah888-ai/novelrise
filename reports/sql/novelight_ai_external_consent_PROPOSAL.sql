-- REVIEW PROPOSAL ONLY; this is NOT a Supabase migration.
-- DO NOT execute on Staging or Production without a new exact-scope approval.
-- This is a reversible schema sketch. Every statement is rolled back.
-- No third-party manuscript transmission is authorized by this proposal.
begin;

create table public.novelight_ai_external_processing_consents (
  actor_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  purpose text not null check (purpose = 'external-novel-bible-analysis'),
  processor text not null check (processor in ('openai', 'gemini')),
  policy_revision text not null
    check (policy_revision ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{3,119}$'),
  granted_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novelight_ai_consent_valid_period
    check (
      expires_at > granted_at
      and expires_at <= granted_at + interval '90 days'
      and (revoked_at is null or revoked_at >= granted_at)
    ),
  primary key (actor_id, novel_id, purpose, processor)
);

-- The composite primary key supports per-actor, per-work, per-processor
-- reads; the FK also requires a leading novel index for delete checks.
create index novelight_ai_external_consent_novel_idx
  on public.novelight_ai_external_processing_consents (novel_id);

alter table public.novelight_ai_external_processing_consents
  enable row level security;

-- No browser role can read or fabricate consent, including anon users.
-- A separately reviewed AUTHOR-JWT consent grant/revoke operation will be
-- required before the feature may run. Do not insert via admin bypass as a
-- substitute for an authenticated author's explicit consent.
revoke all on table public.novelight_ai_external_processing_consents
  from public, anon, authenticated;
grant select, insert, update on table
  public.novelight_ai_external_processing_consents to service_role;

-- No "to authenticated" policy is present. The server-only gate runs with
-- a privileged backend after it independently verifies Auth + work scope.
-- Postgres RLS still protects non-privileged roles; no table is exposed by
-- this proposal because the whole transaction rolls back.
rollback;

-- REQUIRED BEFORE PROMOTION:
-- 1. Obtain an OWNER-approved Staging-only migration with exact main SHA.
-- 2. Define an author-JWT-bound explicit grant/revoke flow with visible
--    processor identity, purpose, current policy revision, retention and
--    cross-border notice. Default remains no consent; revocation is durable.
-- 3. Add concurrency and revocation-race tests, consent audit/cleanup,
--    RLS privilege tests and rollback pre/postchecks.
-- 4. Bind the read gate to EXACTLY the approved AI Router provider routes.
--    Consent to the first provider is insufficient for an unapproved fallback.
-- 5. Until the real grant UI/RPC, Staging evidence, and separate model/budget
--    approval exist, leave external processing and global AI OFF / budget 0.
