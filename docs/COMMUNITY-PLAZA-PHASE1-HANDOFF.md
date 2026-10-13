# NOVELIGHT 交流広場 v1.0 — Phase 1 implementation handoff

2026-10-14 / Source of truth: current user-approved specification (20 sections).
Starting main: `a40dcf9a0cc7a841c95c075aa448ec794f4fb470`.
Work branch: `feat/community-plaza-phase1-20261014`.

## Current safe state

The community feature is **not released**. `novelight-community-config.js` sets
`timeline: false` and `board: false`; this branch has NOT been merged, deployed
or used to change the Production database.

Home code mounts `#communityHomeSection` immediately after the rotating
promotion carousel and before existing discovery shelves. Shared header adds one
`交流` link. `community.html` has tabs for timeline and the future board.
Cards are responsive, show real RPC results when enabled, and never fabricate posts.

Phase 1 reader script calls these RPCs after the migration is explicitly approved:
- `novelight_community_feed` (everyone/following, bounded offset)
- `novelight_community_toggle_like`
- `novelight_community_comments`
- `novelight_community_post_comment`
- `novelight_community_report`

Author note editing uses the old RPC when the flag is off, and opt-in v2 RPCs when
enabled. Existing private/public author note RPCs remain unchanged until verified.

## Data reuse and confirmed behavior

- `author_follow_events` already captures new works and episode publication.
  Do not introduce a duplicate trigger or a second event ledger.
- `author_notes` is private and opt-in is FALSE by default.
- `announcements` is the official announcement source.
- `author_follows` and `user_blocks` / `user_mutes` are canonical safety inputs.
- `novel_comments` are work comments, NOT near-note comments. A single separate
  community comments ledger handles social activity. It must never mutate story
  commentary, Rank, SCOUT XP/Point, LIGHT SEED, favorites or PV.
- General and sensitive_15 metadata may appear; adult_18_nonsexual is excluded
  from the general timeline. Episode visibility must depend on effective publication.
- Episode bursts group per author+work+three-hour window. Live pagination is bounded.
- The R15 and plan-only recommendations in the MASTER remain untouched.

## Approved specification vs prior MASTER

The 2026-10-13 MASTER chapter 43 (author status notes) expressly forbids a
global timeline, likes and note comments. The present approved v1.0 specification
supersedes that feature restriction, while keeping its author-owner access and
no-ranking-influence constraints. Do NOT silently change the MASTER or merge
a MASTER policy change without the repository's explicit approval gate.
A reviewed MASTER amendment must accompany actual Production activation.

## Important limitations before Phase 1 can be called complete

1. `docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql` is a **review draft, not a
   Supabase migration and not applied**. Generate a proper migration using the
   existing Supabase CLI and validate RLS/security on an explicitly authorized
   environment. Do not enable the flag until this is done.
2. Complete admin moderation: review/search reports, hide/restore, rate restrictions,
   staff authorization through the existing server-side admin gate, and audit trail.
3. Complete interaction notifications with idempotent correlation to existing
   follow update notifications; no double notifications.
4. Enforce appropriate community content/rating rules and defend against NSFW
   note bodies and spam; distinguish reports from owner/author content.
5. Verify user block/mute and anonymous visibility on the server, including
   direct API calls bypassing the UI.
6. Instrument traffic from community work cards to novel/episode and authoritative
   valid_read (not raw view counts), plus participant retention and owner dashboard.
7. Verify responsive layout, page/DB failure isolation, cleanup on unpublish/delete,
   note edits and burst imports, existing ranking, LIGHT SEED and SCOUT invariants.
8. Only after production approval, approved migration, and passing checks: switch
   `timeline: true`, merge, deploy. Keep board flag false for Phase 1.
9. Launch Phase 2 only after observing approximately two weeks of Phase 1 data.
   Prepare actual three-category board moderation/threads in its own work branch.

## Cost and gate

No Preview/Staging is allowed without separately explicit `ステージング承認`.
No high-risk Production merge, Supabase migration, or Production deployment is
allowed without explicit `本番承認`. Do not use a generic `承認` or approval
from an unrelated workstream.

NLO was checked via GitHub Bridge Issue #1837, not Desktop Commander;
a health request timed out, so its current health is unverified.
GitHub + read-only Supabase connectors were used for this safe branch work.

## Minimal verification carried out without CI

JavaScript syntax compilation of community JS, shared client JS, flag JS, and
inline scripts on index, community, and author note page: PASS.
Static header count on desktop/mobile: PASS.
Static opt-in v2 references: PASS.
Actual browser UX, integration, RLS, notification, DB migration, migration rollback
and Production behavior: **NOT YET VERIFIED**.
