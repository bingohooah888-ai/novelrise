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

## 2026-10-14 authorized Staging preflight — read-only outcome

User explicitly authorized one-time **Supabase Staging validation** for Phase 1
PR #2222, scoped to main `a40dcf9a0cc7a841c95c075aa448ec794f4fb470`.
No Vercel Preview, Production changes or merge were authorized.

- Production Supabase: `fiepaguycecrredwrcwx`.
- Verified separate Supabase Staging ref: `wmlzjgvxgoyrovdhbqbg`
  (an existing branch of the Production project).
- Staging has 123 public tables. Its 179 recorded migration versions exactly
  match the 179 files in latest main; last applied version `20261013235500`.
  No community table has been migrated.
- Staging is mostly empty; it has 2 source author-follow events, 0 published
  author notes and 0 published announcements. Representative lifecycle tests
  would need isolated fixtures and cannot rely on seeded production-like data.
- Read-only schema comparison confirmed the legacy note save RPC returns
  `{"note_id": bigint, "status": "published"}`, and the existing manage RPC
  returns JSONB. `admin_operation_audit` uses `admin_user_id` as expected.
- Discovered and fixed a breaking typo: the six-argument note-save v2
  previously had a five-argument `GRANT EXECUTE` signature; migration would
  have failed and rolled back.
- Closed a direct comments RPC Block/Mute bypass and excluded timeline near
  notes linked to inaccessible, draft or adult-only novels. Added static
  regression assertions.
- NLO online was verified from Bridge Issue #1837; do not infer NLO state
  from Remote Desktop Commander.
- Recent PR CI: Node tests, formatting/lint, desktop and normal mobile smoke,
  desktop async UI and CodeQL passed on head `b7dc4497...`; mobile async
  synopsis-layout is independently failing in search.html and should be
  rechecked on the new head.

**Hard boundary / no deployment:** The formally authorized Issue #294
`migration-sync` Staging ledger accepts only a 14-digit migration **already
committed on exact latest main**. The Phase 1 review draft is not a migration,
and merging it into main would be a Production deployment action requiring
`本番承認`. A direct Supabase MCP DDL execution would bypass the
OWNER-ledger safety requirement. Accordingly, **NO Staging DDL/write**
occurred under this approval; this is a safe read-only preflight, NOT a
passing Staging integration test. The one-time approval must not be reused
as permission to bypass the gate. Before another external Staging mutation,
the repository's approved sandbox/migration testing route must be
established with a correctly scoped authorization.

Current Phase 1 remains **Draft / not ready to merge**.


## 2026-10-14 subsequent pre-approval implementation

- Existing reader journey events now attribute a community-marked novel/episode
  landing as `source=community` **only for reader journeys**. The shared
  acquisition source, X attribution, PV, Rank and SCOUT are unaffected.
- Proposed `novelight_admin_community_metrics(7|30)` aggregates source-tagged
  journeys, unique visitors, distinct existing server-qualified
  `valid_read_events` within a 24-hour prior community journey window,
  interaction participants, and participants returning on two distinct days.
  It is service-role-only and exposed via existing owner-authenticated admin
  handler; there is no raw user data in the response.
- Curated lists are deliberately NOT auto-discoverable merely because their
  visibility is `shared` (shared URL). The new
  `community_share_enabled` column defaults FALSE and can be set only
  through owner-scoped RPC. Switching a list to `private` resets consent.
  The share token enters the public timeline response only after this extra
  consent and remains revocable.
- LIGHT SEED giver activity is also **strict opt-in**. The
  `community_seed_shares` table (RLS, no raw reader/client access) records
  one share per existing awarded seed. A giver can opt in or revoke via
  the history page and an owner-bound RPC. Unpublished/R18 works disappear
  from the feed without deleting the underlying historical LIGHT SEED;
  the Rank/XP/award ledgers are never written by community.
- The review SQL was reconstructed after accidental JavaScript replacement
  expansion was found; verified one `BEGIN`, one `COMMIT`, 18 function
  definitions, 36 `$$` markers and zero invalid `AS $` delimiters.
  This is **static text validation only**, not SQL execution.

### Production rollback and failure containment

1. Before a formal migration, rollback consists solely of discarding this
   draft PR. Production remains unchanged.
2. If an approved database migration is subsequently installed but the UI
   remains gated off, leave both `timeline` and `board` FALSE. Avoid
   destructive rollback of consent and notification records unless a
   separately audited restore has been approved.
3. If the community feature is approved and later creates a public-content
   or moderation incident, disable the `timeline` feature gate through
   the separately authorized Production route, then verify home/navigation,
   author notes, and community RPC access. Do not assume hiding a link alone
   revokes RPC privileges; the DB needs its own separately approved
   fail-closed revocation mechanism in the formal migration.
4. Preserve the original existing `author_notes`,
   `author_follow_events`, `reader_curation_lists`, `light_seeds`,
   `valid_read_events`, Rank and SCOUT source data throughout rollback.
   New community records should only be archived or dropped following
   an explicit retention/privacy review and verified backup.
5. The restored Production revision, schema versions, delegated RPC grants,
   hidden post visibility and activity counters require read-only postcheck.

### Missing completion evidence

The formal 14-digit Supabase CLI-created migration has **not** been
generated or installed. No authorized PR-head SQL integration test can use
the existing Issue #294 ledger, because it accepts only a migration
already committed on exact current `main`. The one-time earlier Staging
approval was used for read-only isolation/provenance inspection; it must
not be stretched into another mutation or workaround. The Staging
database still had zero `community_%` tables at last inspection.
The feature cannot truthfully be called Production-ready without a
reviewed PR-head isolated RLS test route, migration order proof,
role-separation and direct-RPC attacks testing, official moderation
and data retention review, plus full responsive E2E.

NOTE: Previous early-document statements describing missing features
refer to the historical implementation phase; this dated continuation
supersedes those status items. Nothing in this document authorizes
a Production change or a paid Preview.

## 2026-10-14 additional public-feed consent invalidation

Read-only inspection of existing Staging RPC code showed that legacy note
edits and curation-list share-token rotation could preserve earlier public
feed consent. Proposed, unexecuted SQL now includes before-update triggers:
editing note title/body/linked novel/status resets `show_in_timeline`;
changing list title/description/visibility/share token resets
`community_share_enabled`. Re-sharing requires explicit owner opt-in.
The v2 note save wrapper reasserts consent after a canonical legacy save,
only after a fresh general-audience confirmation. Both server trigger
behaviors require isolated authorized testing before launch.

## 2026-10-14 isolated post-migration role tests prepared

`tests/rls/community-plaza-phase1-security.sql` is a focused role/RLS
test for **disposable migration-replay PostgreSQL only**. Once an isolated
DB has applied the approved formal migration, use
`psql -v ON_ERROR_STOP=1 -f tests/rls/community-plaza-phase1-security.sql`
there. It checks seven private tables, raw client grants, ADMIN-only RPC
grants, anonymous feed and unauthenticated interaction denial. The
transaction rolls back. It is NOT an applied migration or a passing
integration test; cross-user, consent and notification fixtures remain.

## 2026-10-14 automatic disposable SQL replay integration

The existing `scripts/run-rls-integration.sh` now applies the **review
draft only to its fresh, disposable local PostgreSQL migration-replay
database**, immediately after all main migrations and the existing
contest fixture. It then runs
`tests/rls/community-plaza-phase1-security.sql`. This is a CI-only
syntax/schema/role safety gate: no hosted Supabase Staging or Production
endpoint, no migration ledger entry, no Preview deployment. This does
NOT make the review draft a deployable migration. Any successful
result is explicitly limited to the disposable SQL replay; separate
user-authorized Staging and formal migration procedures remain required.

## 2026-10-14 isolated PostgreSQL runtime finding

Disposable CI replay successfully installed the proposed review DDL, but its
first role/anonymous-feed execution exposed PostgreSQL `GROUP BY`
error `e.novel_id must appear in GROUP BY` within the grouped episode
activity branch. The feed now uses grouped `n.id` (equal by join) for the
episode post key, preserving the canonical key format. Static assertions
pin the grouped column. A fresh disposable SQL replay is required to
establish runtime success; Staging and Production have not been changed.

## 2026-10-14 confirmed disposable SQL integration proof

GitHub Actions run `38512225649`, job `115683134543`
(`RLS integration and rollback`) **passed** after replaying latest main
migrations into a temporary PostgreSQL 17 CI container. The job applied
`docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql` successfully, then passed
`tests/rls/community-plaza-phase1-security.sql` including client-role
table isolation, admin RPC grant separation, anonymous feed, and missing-user
interaction denial. An earlier disposable replay (job
`115682448309`) found the grouped episode key error; the fix replaced
`e.novel_id` with grouped `n.id`.

This is **CI-disposable DB evidence only**, not Supabase Staging,
Production, or cross-user behavior tests. The SQL remains review-only and
requires formal CLI-created migration, explicit rollback decision and
authorized Staging testing before activation. Manual Production approval
is NOT granted by CI success.

## 2026-10-14 cross-user and moderation behavior replay

Added `tests/rls/community-plaza-phase1-behavior.sql` to the
disposable replay job to simulate two isolated authenticated users,
author Block, reader Mute, direct comment/like, admin-hidden posts,
legacy note edit, confirmed V2 re-share, shared-link-only curation,
explicit discovery opt-in, token rotation, changed description, and
cross-user permission denial. All records roll back in a disposable CI
PostgreSQL container.

Review of the prior draft found that a moderated, hidden post was
excluded from the feed but `novelight_community_post_visible`
did not itself check `community_hidden_posts`. Therefore crafted
direct RPC requests could still read comments or interact with a hidden
post. Proposed draft now rejects hidden posts centrally, so direct
comments, likes, reports, and notifications inherit the same ban.
This is a pending CI hypothesis until the new behavior replay succeeds.

## 2026-10-14 confirmed two-user disposable integration pass

GitHub CI run `38514339032`, RLS job `115689891039`, completed
**success**. Runner evidence includes the SQL DDL, role test, and a separate
transaction-starting behavior fixture with two auth.users, public note,
like/comment, author Block, reader Mute, hidden post, legacy save, V2
opt-in, private/shared curated list, revoked share URL, edited list text,
and attempted non-owner opt-in. All assertions passed and the fixture
transaction rolled back. CodeQL and relevant browser checks were also
successful on the previous head. The new public-visibility check forbids
direct comment retrieval and like/report interactions for admin-hidden
posts, not only hiding cards from the timeline.

This is **NOT evidence of cross-user Supabase Staging validation**:
the replay PostgreSQL does not include all Supabase gateway/auth/session
semantics or the latest hosted RLS policies. The feature remains gated off.
The remaining publishing prerequisites are a formal CLI migration and
postchecks, specifically authorized Staging SQL/RLS and rollback checks,
full moderator flow and retention review, and the project-specific
high-risk merge/Production authorizations.

## 20261014052000 formal migration candidate (not merged/deployed)

The Phase 1 SQL single source of truth has moved to
`supabase/migrations/20261014052000_community_plaza_phase1.sql`. This is a **reviewed filename/content candidate in a
DRAFT PR**, not proof of Supabase CLI migration registration or hosted DB
application. The retired `docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql`
contains only a pointer to prevent conflicting SQL copies.

Precheck: `supabase/checks/20261014052000_community_plaza_phase1_precheck.sql`.
Postcheck: `supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql`.
Guarded rollback: `supabase/rollback/20261014052000_community_plaza_phase1_rollback.sql`.
Postrollback: `supabase/checks/20261014052000_community_plaza_phase1_postrollback.sql`.

Disposable PostgreSQL CI must precheck + replay migration, postcheck +
role/cross-user behavioral tests, then guarded rollback/postrollback +
fresh reapply and re-test. Rollback refuses to destroy any community
interactions, notifications, public opt-ins or seed shares. On hosted
environments, disabling the app feature flag is the primary containment;
a destructive rollback requires separate audit, approval and backup.

**Approval boundary:** current Issue #294 Staging sync requires an
exact-main committed migration plus one-time OWNER ledger authorization.
This PR remains draft, is NOT part of main, and must not be merged or
applied to hosted Staging as a workaround. Do not interpret PR branch
migration readiness as Production approval. Next real Staging step
requires separately approved, policy-compliant execution.

## 2026-10-14 database release switch added

UI-only gating was not sufficient: public REST/RPC calls were reachable
immediately after an approved DB install. The migration now creates a
single private `community_runtime_control` row, default
`public_enabled=false`, without client table grants. Public feed
returns an empty JSON array and post visibility returns false when OFF.
Owner opt-in enrolment cannot be newly enabled while OFF. Only a
separately approved SQL mutation after final hosted Staging tests may
enable the switch. CI enables it temporarily in a transaction which
always rolls back; Production and Staging remain OFF / unchanged.

The historical migration-replay runner rolls back and recreates canonical
author-notes and curation-list source tables after replay, which can
remove additive community columns. The focused community test group now
replays the idempotent community migration once after those historical
fixtures restore the canonical tables, before checking grants and
exercising guarded rollback/reapply. This is a CI-only integration order
fix and does not affect deployment ordering.
