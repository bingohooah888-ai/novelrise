# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-10 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Older proof is reused only when the current scope is demonstrated to be unchanged or materially equivalent.

## Release decision

**Historical controlled public-beta GO: RECORDED 2026-08-28.**

**Current launch posture: BLOCKED — approved official novel thumbnail assets are not yet prepared/populated in Production, so new novel submission cannot complete. A fresh Production Authenticated Smoke is required only after that content dependency is satisfied.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current material launch main at this reconciliation: `a505814b1a16c8b30d5731ed5db602f2c032d026` (`Block release readiness when official thumbnails are absent (#475)`).

The current blocker is a known launch-preparation dependency, not evidence that the official-thumbnail feature implementation or permissions are broken. Read-only Production inspection found `public.novel_thumbnail_assets` present with its access boundary intact but with 0 total / 0 active rows, and the `novel-thumbnails` Storage bucket with 0 objects. `post.html` intentionally keeps novel submission disabled until an active official thumbnail is available.

Two fresh approval-gated Production Authenticated Smoke attempts were executed after Chapter 38. Both were safely claimed, created only ephemeral Production smoke state, failed in the browser verification phase, and completed cleanup. The first exposed stale smoke assumptions that were corrected by PR #473; the second confirmed that the empty official-thumbnail catalog remains a real prerequisite for the posting flow and also exposed a stale author-profile selector corrected by PR #475. Neither failed run is PASS evidence.

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This is an operational release posture, not a finding of legal sufficiency.

## Freshness decision table

| Scope | Newest decisive proof | Freshness on current launch main | Status |
| --- | --- | --- | --- |
| Repository CI / browser regression | PR #475 head CI #2006 / run `34459125776` | current code-equivalent; all required gates passed before squash merge | PASS |
| CodeQL | PR #475 head CodeQL #1918 / run `34459125775` | current code-equivalent | PASS |
| Vercel Production deployment | commit status on merge main `a505814b...` | exact-current deployment status | PASS |
| Official thumbnail availability | read-only Production inspection before PR #475 | current launch dependency; 0 catalog rows / 0 active rows / 0 Storage objects | BLOCKED |
| Production Readiness logic | PR #475 | exact-current code; zero active official thumbnails now fail deterministic integrity | BLOCKING UNTIL ASSETS EXIST |
| Supabase Production migrations | approval-ledger executions/postchecks through `20260910143000` | current Production state | PASS |
| Production authenticated beta-critical flows | Issue #474 / run `34456994468` | fresh attempt, but browser verification failed; cleanup succeeded | FAIL / RERUN AFTER THUMBNAILS |
| Stripe/billing | Stripe Production Bootstrap #7 / run `33612120034` | still-valid; no later pricing/billing contract change in this reconciliation | PASS |
| Backup/restore | Production Backup Freshness #8 / run `33354249864` plus recorded non-Production restore rehearsal | still-valid; no backup-control change | PASS |
| Legal counsel | owner-deferred | unchanged | PENDING / ACCEPTED RESIDUAL RISK |

## Git / CI — PASS

Current main is `a505814b1a16c8b30d5731ed5db602f2c032d026`.

PR #475 was merged only after its head `2b45ee4f89f8cc216f63979ef6941e279e8978db` passed:

- `NOVELIGHT CI` #2006 / run `34459125776`: `success`;
- Merge readiness preflight: `success` after exact OWNER high-risk approval;
- required aggregate `check`: `success`;
- Node tests and static quality: `success`;
- desktop/mobile smoke browser jobs: `success`;
- desktop/mobile async-UI browser jobs: `success`;
- `CodeQL` #1918 / run `34459125775`: `success`.

The squash merge produced current main `a505814b...`; Vercel Production commit status on that exact merge commit is `success`.

## Official thumbnail launch dependency — BLOCKED / CONTENT NOT YET POPULATED

The official-thumbnail schema and privilege hardening remain part of Production state. The blocking condition is the absence of actual approved thumbnail assets.

Read-only Production inspection established:

- `public.novel_thumbnail_assets` exists;
- RLS / client read access needed by the posting UI is intact;
- total catalog rows: 0;
- active catalog rows: 0;
- `novel-thumbnails` Storage objects: 0.

The repository does not contain an approved production thumbnail catalog to seed automatically. The official-thumbnail migration intentionally does not invent or seed artwork; the intended operational path is to upload approved assets and create catalog entries through the existing ADMIN workflow.

PR #475 added `active_official_thumbnails_present` to the deterministic Production Readiness integrity checks. This means an empty official-thumbnail catalog is now a release blocker instead of silently allowing a readiness PASS.

Do not upload a placeholder logo or synthetic test image to Production merely to force the smoke to pass. The next Production write in this area should occur only after an approved official thumbnail set exists and receives its own explicit Production authorization.

## Supabase Production — PASS / CURRENT VIA APPROVAL LEDGER

Previously reconciled Production migrations through `20260906120000_author_profile_avatar_and_activity.sql` remain historical/current state and are not rerun for documentary freshness.

Chapter 38 added material Production state after the 2026-09-06 evidence snapshot. Confirmed approval-ledger executions include:

- foundation batch containing `20260909071500_scout_beta_event_foundations.sql` and `20260909071510_scout_beta_rules_rls.sql`:
  - ledger issue `#165`;
  - approved main `7e7b657048c4c13ec9a9185182c83dd93839d4dc`;
  - bridge run `34315738396`;
  - `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.
- `20260909080000_disable_light_seed_v1_client_rpcs.sql` and `20260909100000_chapter38_work_rank_engine.sql` were applied during the Chapter 38 Production rollout before the later lifecycle/rank migrations; prior deployment precheck/postcheck evidence remains part of that rollout history and is not re-executed here.
- `20260909120000_chapter38_work_rank_lifecycle.sql`:
  - ledger issue `#165`;
  - approved main `e6de1ec2ec0366f5ca22511f771f0e6a1bbe0371`;
  - bridge run `34335400168`;
  - mutation/postcheck `success`.
- `20260909130000_chapter38_rank_bayesian_percentiles.sql`:
  - ledger issue `#165`;
  - approved main `cb9e753595254763c9176f5909343d2d27b1c451`;
  - bridge run `34340585331`;
  - mutation/postcheck `success`.
- `20260909140000_chapter38_seed_discovery_exp.sql`:
  - ledger issue `#165`;
  - approved main `d34be989cd3c55b3679420a4ec605c35e377f9f9`;
  - bridge run `34358566221`;
  - mutation/postcheck `success`.
- `20260909190000_chapter38_star_rating_scout_exp.sql`:
  - active ledger issue `#460`;
  - approved main `5f773101bf6c0f05cdf8b043363b184b34d896bf`;
  - bridge run `34408554615`;
  - `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.
- `20260910070000_chapter38_comment_scout_exp_foundation.sql`:
  - issue `#460`;
  - approved main `824fdfb5e2f466b0f26623de94cc834fcfb7a717`;
  - bridge run `34413902759`;
  - mutation/postcheck `success`.
- `20260910143000_chapter38_exclude_self_comment_scout_exp.sql`:
  - issue `#460`;
  - approved main `da1b8bd765e3b79cce56ea17fa05d6dd8d81795b`;
  - bridge run `34441780108`;
  - `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.

No Production migration is executed by this documentary reconciliation.

## Chapter 38 product boundary — IMPLEMENTED / FINAL AUTH PROOF PENDING

Current code and Production migration state contain the beta foundations required by MASTER Chapter 38, including:

- replayable SCOUT event and EXP ledgers;
- valid-read sessions/events and anti-duplication rules;
- reader heartbeat/progress signaling from the episode reader;
- LIGHT SEED event attribution and send-time Rank capture;
- Work Rank calculation/history lifecycle and Bayesian/percentile logic;
- 180-day LIGHT SEED discovery EXP;
- star-rating SCOUT EXP;
- comment SCOUT EXP with self-comment exclusion;
- ADMIN beta analysis support;
- beta UI hiding SCOUT Level, Rank, badges, EXP, and unreleased SCOUT RECORD mechanics while keeping LIGHT SEED send history separate.

This implementation/deployment state does **not** substitute for a successful fresh approval-gated Production Authenticated Smoke. That smoke is intentionally deferred until the official-thumbnail prerequisite is populated so the posting path can be exercised meaningfully.

## Production authenticated beta-critical path — TWO FAILED ATTEMPTS / CLEANUP PASS

Historical successful proof remains Issue #393 / run `34025686074` on main `5a5b502c61d984bf7d0329ea59a8d99b55b05861`. It remains historical evidence only for unchanged boundaries and is not current proof for later Chapter 38 behavior.

Fresh attempt 1:

- request issue `#472`;
- approved main `8d618f243f97057c1f4202c20b6f873cd12e5244`;
- run `34453321240`;
- exact OWNER approval -> `CLAIMED`;
- authenticated browser verification: `failure`;
- ephemeral Production smoke-data cleanup: `success`;
- temporary Production credential / fixture cleanup: `success`;
- issue ledger result: `NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED`.

This run exposed smoke assumptions that no longer matched the current beta UI. PR #473 aligned the smoke with official-thumbnail selection, valid-read-before-SEED ordering, the current LIGHT SEED UI/history naming, and the current author-room heading.

Fresh attempt 2:

- request issue `#474`;
- approved main `ce1442bc325e309be23c50767af5585c2f27ea16`;
- run `34456994468`;
- exact OWNER approval -> `CLAIMED`;
- authenticated browser verification: `failure`;
- ephemeral Production smoke-data cleanup: `success`;
- temporary Production credential / fixture cleanup: `success`;
- issue ledger result: `NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED`.

The second run failed because the Production posting flow had no `.thumbnail-option` to select while the official thumbnail catalog was empty, and because the author-profile smoke still referenced the removed `#profileBioSummary` element. PR #475 corrected the author-profile selector and added the empty-thumbnail release-readiness blocker. It did **not** create thumbnail content.

Required release-proof sequence from the current state:

1. prepare an approved official thumbnail set;
2. under a separate explicit Production authorization, upload/catalog the approved assets through the existing ADMIN path;
3. run Production Readiness and require `active_official_thumbnails_present=true` with the other deterministic checks passing;
4. create a fresh non-expired Production Auth Smoke request for the then-current or demonstrated backend-equivalent main;
5. obtain exact OWNER approval and require the decisive authenticated verification job to pass;
6. require cleanup and matching `CONSUMED result="success"` evidence;
7. reconcile this evidence and the release checklist before restoring CURRENT LAUNCH POSTURE to GO.

Do not count #472 or #474 as successful authenticated smoke proof, and do not rerun the smoke while the known thumbnail prerequisite remains unsatisfied.

## Production billing / Stripe / entitlement — PASS / STILL VALID

The beta billing contract remains:

- Standard: beta period `0円`, credit card not required;
- Premium: beta special price `月額480円`;
- Premium regular/formal price: `月額1,980円`.

Decisive live billing proof remains `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` on `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`, conclusion `success`.

No Chapter 38, PR #473, or PR #475 change reviewed in this reconciliation alters Stripe pricing, checkout/billing route semantics, entitlement pricing, Stripe Secrets, or Vercel billing configuration. Live billing operations are therefore not repeated merely to refresh documentation.

## Backup / restore — PASS / STILL VALID

Newest accepted read-only backup evidence remains `NOVELIGHT Production Backup Freshness` #8 / run `33354249864`, conclusion `success`, together with the previously recorded non-Production restore rehearsal and `docs/BACKUP-RESTORE-RUNBOOK.md`.

No change reviewed here modifies the backup/restore control boundary. No Production restore or backup mutation is repeated.

## Content / moderation / ADMIN — PASS WITH SCOPE LIMIT

Previously established content classification/warning/report privacy and ADMIN allowlist controls remain in force. Chapter 38 ADMIN beta analytics has repository CI/CodeQL coverage, but Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Legal / brand status

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING**. The recorded owner residual-risk decision remains historical and explicit. Nothing in this evidence file asserts legal sufficiency.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

An `[x]` means current or specifically justified still-valid evidence exists. An `[ ]` means proof is missing/stale, content preparation is incomplete, or a manual/external gate is still open. A stale or failed proof is not converted into PASS merely because repository CI is green.

## Current release state

**Controlled public-beta historical GO remains recorded, but CURRENT LAUNCH POSTURE is BLOCKED as of 2026-09-10.**

Current material main: `a505814b1a16c8b30d5731ed5db602f2c032d026`.

Repository CI/CodeQL for the PR #475 code-equivalent head and Vercel Production for exact current main are successful. Chapter 38 Production migrations remain reconciled through successful approval-ledger execution/postchecks. Both fresh authenticated smoke attempts completed their safety cleanup but failed browser verification and therefore provide no new PASS evidence.

**The immediate blocker is that approved official thumbnail assets are not yet populated in Production. After they are prepared and explicitly authorized for Production upload/cataloging, Production Readiness must pass and a new approval-gated Production Authenticated Smoke must succeed before CURRENT LAUNCH POSTURE can return to GO.**
