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


## 2026-10-14 additional Phase 1 branch changes (pre-approval)

- Release flags now originate in `novelight-client.js` for shared public
  headers; `novelight-community-config.js` is a compatibility shim. Both
  remain disabled and no hidden header link should be promoted pre-approval.
- New moderator API `api/admin-community.js` wraps
  `api/_lib/admin-community.js`, calling existing `requireAdmin`, requiring
  a Bearer token, and invoking the private atomic SQL moderation function.
- `admin-community.html` provides report/hidden/restriction review and
  reversible staff actions. It is not to be enabled until schema + permissions
  are verified. `admin.html` links to the preparation screen.
- Notes now require explicit general-audience confirmation whenever the
  author opts into timeline display. The SQL v2 note-save function validates
  this independently of the UI.
- `novelight-community-alerts.js` introduces a small per-user reaction inbox,
  without changing existing author-follow update notifications. SQL draft adds
  idempotent like/comment/reply entries, and per-user rate restrictions.
- Comments may reply to a specific earlier comment. The server draft checks
  ownership visibility and Block/Mute in addition to input/rate validation.

## Current pre-approval blocker

**The feature is NOT yet ready for Production approval.** Before switching its
flag on, the remaining required checks are:

1. Convert `docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql` to a formal
   `supabase/migrations/` file with `supabase migration new` on a correctly
   authorized, isolated worktree. Verify migration syntax, ordering and
   backward-compatible restoration.
2. Run focused isolated DB integration tests (role/permission, anon viewing,
   owner-only note sharing, age zoning, hidden/deleted/scheduled events, likes
   and comments, moderation, notification idempotency and restrictions).
3. Integrate and verify community-specific visits, transitions, authoritative
   valid-read attribution and retention metrics without touching Rank/SCOUT.
4. Run responsive browser checks for the home, community, note editor and
   moderation screen. Confirm no regressions to other discovery shelves.
5. Pass repository Prettier, ESLint, syntax, focused tests and security CI.
6. Prepare a reviewed MASTER v1.0 supersession note for its existing
   near-note restriction; never silently override chapter 43 in Production.
7. The Stage/Preview approvals are independent and **not granted** by
   a generic implementation request. No Vercel Preview or Supabase staging
   mutation has been executed.
8. After successful authorized staging tests, a separate `本番承認`
   is required before high-risk merge, Production DB migration or release.

## Static verification

An in-memory read-only inspection on current branch confirms:
- 10 executable script/module syntax checks passed after excluding JSON-LD
  (which is data, not executable JavaScript).
- Disabled flag, shared header gating, home carousel placement and
  server-side owner guard present.
- Six private new logical tables in the review draft have RLS declarations,
  with SELECT/INSERT exposed only via bounded security-checked RPCs.
- SQL dollar quoting is balanced, without any observed SQL execution.
This is **not** a substitute for Prettier/ESLint, SQL validation or live tests.
