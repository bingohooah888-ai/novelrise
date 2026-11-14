-- NOVELIGHT formal reader/comment rewards: four private tables only.
-- Draft PR #2762; Staging approval is required separately. DO NOT EXECUTE NOW.
-- Extracted from docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql.
-- No reward functions, triggers, grants, background worker, or canonical writes.
-- Use the existing single atomic Supabase migration runner after OWNER approval.
-- Existing LEVEL and Point usage tables/functions are not modified.

create table novelight_formal_private.scout_read_level_evidence (
  read_event_id uuid primary key references public.valid_read_events(id)
    on delete restrict,
  reader_id uuid not null references auth.users(id) on delete cascade,
  qualified_at timestamptz not null,
  scout_level smallint not null check (scout_level between 1 and 100),
  level_revision bigint not null check (level_revision >= 0),
  captured_at timestamptz not null default clock_timestamp()
);

create table novelight_formal_private.scout_comment_eligibility (
  comment_id uuid primary key references public.novel_comments(id)
    on delete restrict,
  eligible boolean not null,
  reviewer_rule text not null
    check (char_length(reviewer_rule) between 1 and 120),
  verified_at timestamptz not null default clock_timestamp()
);

create table novelight_formal_private.scout_comment_review_evidence (
  review_id uuid primary key,
  comment_id uuid not null unique references public.novel_comments(id)
    on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  comment_user_id uuid not null references auth.users(id) on delete restrict,
  episode_id bigint not null check (episode_id > 0),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  eligible boolean not null,
  reviewer_rule text not null
    check (char_length(reviewer_rule) between 1 and 120),
  reviewed_at timestamptz not null default clock_timestamp()
);

create table novelight_formal_private.scout_earning_delivery (
  event_type text not null check (
    event_type in ('valid_read_qualified','novel_episode_comment_reviewed')
  ),
  event_id uuid not null,
  state text not null default 'pending'
    check (state in (
      'pending','review_pending','retry','leased','completed','held'
    )),
  moderation_decision boolean,
  moderation_rule text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  last_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_type,event_id),
  check (
    (lease_token is null and leased_until is null)
    or (lease_token is not null and leased_until is not null)
  ),
  check (
    moderation_rule is null
    or char_length(moderation_rule) between 1 and 120
  )
);

-- All four tables stay private and inaccessible to application roles.
-- No policies or GRANT: future trusted server role must be separately bound.
alter table novelight_formal_private.scout_read_level_evidence
  enable row level security;
alter table novelight_formal_private.scout_comment_eligibility
  enable row level security;
alter table novelight_formal_private.scout_comment_review_evidence
  enable row level security;
alter table novelight_formal_private.scout_earning_delivery
  enable row level security;

revoke all on table
  novelight_formal_private.scout_read_level_evidence,
  novelight_formal_private.scout_comment_eligibility,
  novelight_formal_private.scout_comment_review_evidence,
  novelight_formal_private.scout_earning_delivery
  from public, anon, authenticated, service_role;
