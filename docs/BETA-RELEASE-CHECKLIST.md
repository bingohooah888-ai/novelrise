# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-16 JST.**

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Current material launch main at reconciliation: `a7bd226a7a4f457bf593df6084ba4d676af5b444` (`Add beta scheduled episode publication (#609)`).

Repository `main` may advance through later documentation-only reconciliation commits. In this checklist, **material application SHA** means the latest commit that changed deployable application behavior; a docs-only successor does not by itself make that application proof stale.

**CURRENT LAUNCH POSTURE: GO — PR #609 substantive reviewed-head CI and CodeQL evidence are green; exact current material application SHA `a7bd226a...` is deployed successfully to Vercel Production; Production Readiness #167 / run `35073115512` and `production-beta-verification` are green on that exact SHA; Production migration `20260916100000_episode_scheduled_publication.sql` was applied under exact-scope owner approval through bridge run `35074760475` with mutation/postcheck success and no pending migrations afterward. This evidence does not claim a live elapsed-time scheduled-publication Production fixture, and the older authenticated Chapter 38/40 smoke is not stretched into proof of PR #609.**

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision is recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## 2026-09-16 post-PR #609 scheduled-publication reconciliation

This section supersedes older “current”, “material application main”, and final release-posture wording below where the scope overlaps. Older checked evidence remains preserved for audit/regression history.

- [x] Current repository `main` and material application SHA are `a7bd226a7a4f457bf593df6084ba4d676af5b444` (`Add beta scheduled episode publication (#609)`).
- [x] PR #609 final reviewed head is `1e7e2ecb82bf7c91fb83165db30570290ab48d62`.
- [x] PR #609 `NOVELIGHT CI` #2458 / run `35059409607` has successful static quality, Node tests, RLS integration/rollback, desktop/mobile browser smoke, and desktop/mobile async-UI jobs; merge remained separately gated on exact-head owner high-risk approval rather than treating the pre-approval aggregate gate as already satisfied.
- [x] PR #609 CodeQL #2362 / run `35059409539` completed `SUCCESS`.
- [x] Exact current main `a7bd226a...` has Vercel Production, `production-readiness-smoke`, and `production-beta-verification` commit statuses `success`.
- [x] `NOVELIGHT Production Readiness Smoke` #167 / run `35073115512` completed `success` on exact current main `a7bd226a...`.
- [x] Production Readiness #167 successfully verified Production static routes, safe API route contracts, a read-only Production reader smoke, Production beta observability, and readiness status publication.
- [x] The Production Auth Smoke dispatch step inside Readiness #167 is request-only evidence and is not treated as authenticated Production PASS.
- [x] Before scheduled-publication migration deployment, the actual Production pending set was confirmed to be exactly `20260916100000`; the dry-run would apply only `20260916100000_episode_scheduled_publication.sql`.
- [x] Issue #460 contains the exact owner approval for operation `supabase-migration-deploy`, main `a7bd226a...`, challenge `11F8CA25`, and migration set `["20260916100000"]`, followed by the matching GitHub-Actions claim bound to bridge run `35074760475`.
- [x] Approved Production migration bridge run `35074760475` revalidated the exact approval/current-main boundary, applied only `20260916100000_episode_scheduled_publication.sql`, and recorded `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.
- [x] Post-deploy migration status shows `20260916100000` in both Local and Remote with no remaining pending migration; Production beta integrity checks and monitoring-signal checks passed.
- [x] The migration/application evidence proves the scheduled-publication schema/control path, owner-bound schedule/cancel boundary, due-publication job, lifecycle validation, and current Production readiness/observability state; it is not mislabeled as a live authenticated elapsed-time schedule-and-publish E2E fixture.
- [x] No Production draft/work/episode fixture is created merely to force documentary scheduled-publication E2E proof.
- [x] Issue #511 / run `34692176490` remains still-valid only for its actually executed Chapter 38/40 authenticated create/render/LIGHT ANALYTICS scope; it is not direct Production authenticated proof of PR #609 scheduled publication.
- [x] No duplicate migration, Auth Smoke, Stripe operation, Secret change, campaign-state cutover, or Production fixture creation is justified solely for documentary SHA freshness.
- [x] This documentation reconciliation performs no Production DB/Supabase mutation, migration rerun, Auth configuration mutation, Stripe/billing/entitlement mutation, Secret/environment mutation, Production Auth Smoke execution, campaign-state cutover, or image generation/editing.
- [x] Qualified Japanese counsel review remains pending/deferred by owner and is not converted into legal PASS by the technical reconciliation.

## 2026-09-16 current-main / post-PR #601 reconciliation

This section supersedes older “current”, “material application main”, and final release-posture wording below where the scope overlaps. Older checked evidence remains preserved for audit/regression history.

- [x] Current repository `main` and material application SHA are `bac6e7ba4bd75bb91b244dc61ea30a3987fb4f54` (`Polish empty and error states for discovery lists (#601)`).
- [x] PR #601 final reviewed head `0d42b7693b000aa18b639f240f4a484bcb0e1bd5` passed `NOVELIGHT CI` #2414 / run `34998719910`, including Node tests, static quality, desktop/mobile browser smoke, desktop/mobile async-UI, and aggregate `check`.
- [x] PR #601 passed CodeQL #2319.
- [x] PR #600 final reviewed head `31dee9b8fd001d092aa2b9419354a71c7059d159` passed `NOVELIGHT CI` #2412 / run `34997621134`, aggregate `check`, and CodeQL #2317.
- [x] Exact current main `bac6e7ba...` has Vercel Production commit status `success` and `production-readiness-smoke` commit status `success`.
- [x] `NOVELIGHT Production Readiness Smoke` #162 / run `34998927013` completed `success` on exact current main `bac6e7ba...`.
- [x] Production Readiness #162 verified static convergence for `light-seed.html`, `new-arrivals.html`, and `recommended.html`, safe API route contracts, a read-only Production reader Playwright smoke (`1 passed`), Production beta integrity checks, and monitoring-signal presence.
- [x] Production browser verification confirms PR #601's mode-specific empty states on new arrivals, recommendations, and LIGHT SEED pages.
- [x] PR #600 live resume E2E was not falsely marked PASS: Production had zero published works, so no test fixture/public work was created merely to force a resume scenario. PR #600 remains supported by reviewed-head CI/contract coverage and deployed code.
- [x] `20260915113000_preregistration_auth_signup_gate.sql` is applied through exact-scope bridge run `34928307571`, with mutation/postcheck success.
- [x] Production hosted preregistration Before User Created hook control completed successfully on run `34941475822`, including `configPostcheck="success"` and `blockedSignupSmoke="success"` on the direct-signup verification path.
- [x] `20260915173000_enforce_profile_auth_user_integrity.sql` is applied through bridge run `34948923156`, mutation/postcheck success.
- [x] `20260915180000_restrict_internal_trigger_function_execute.sql` is applied through bridge run `34950821474`, mutation/postcheck success.
- [x] `20260915190000_optimize_profile_rls_initplan.sql` and `20260915191000_drop_duplicate_favorites_index.sql` are applied through bridge run `34963347035`, mutation/postcheck success.
- [x] Guarded Production leaked-password protection enablement completed on run `34964896832`, recording `passwordHibpEnabled=true` and `mutationApplied=true`.
- [x] `20260916001000_beta_episode_drafts_and_import.sql` is applied through exact-scope bridge run `34993636592`, with mutation/postcheck success.
- [x] PR #592's migration/application state is not overstated: applied migration evidence does not by itself become a Production authenticated E2E PASS for the bulk-import UI/RPC workflow.
- [x] Post-#560 current application changes include forward-only prereg lifecycle enforcement (#576), operator/trust and prereg legal isolation (#585/#587/#588), local reader/author continuity and draft safety (#589), private episode draft import/staged publication (#592), LIGHT ANALYTICS opportunity clarification (#593), read-only ADMIN discovery watch (#596), state-aware onboarding (#598), home continue-reading (#600), and discovery empty/error polish (#601).
- [x] Issue #511 / run `34692176490` remains still-valid only for its actually executed Chapter 38/40 authenticated create/render/LIGHT ANALYTICS scope; it is not direct Production proof of PR #592/#600/#601-specific behavior.
- [x] A Production Auth Smoke request dispatched by Production Readiness #162 is request-only evidence and is not treated as authenticated Production PASS.
- [x] Production preregistration trust/legal navigation was re-audited through operator, terms, privacy, commerce disclosure, contact, content guidelines, and billing policy; no visible/clickable route into the unreleased main product was found in the rendered legal chain.
- [x] No duplicate migration, Auth Smoke, Stripe operation, Secret change, campaign-state cutover, or Production fixture creation is justified solely for documentary SHA freshness.
- [x] Qualified Japanese counsel review remains pending/deferred by owner and is not converted into legal PASS by the technical reconciliation.

## 2026-09-14 post-PR #560 / Production funnel reconciliation

This section supersedes older “current”, “material application main”, and final release-posture wording below where the scope overlaps. The older detailed checked evidence is preserved for audit/regression history.

- [x] Current repository `main` and material application SHA are `21f9e581f4009303904067d18bc5bea05c641d43` (`Add beta author preregistration conversion funnel (#560)`).
- [x] PR #560 final reviewed head `dec5fcbabf7ce169386a16bd03d4a7907d83a149` passed `NOVELIGHT CI` #2333 / run `34844107206`, including Node tests, static quality, RLS integration/rollback, desktop/mobile browser smoke, desktop/mobile async-UI, and aggregate `check`.
- [x] PR #560 passed CodeQL #2239 with no new code alerts in the changed code.
- [x] On merged main `21f9e581...`, Vercel Production, `production-readiness-smoke`, and `production-beta-verification` commit statuses are all `success`; Production Readiness Smoke #142 is green.
- [x] The preregistration funnel is now `LP表示 → CTAクリック → フォーム入力開始 → 登録ボタンクリック → 登録成功`; source/UTM attribution is retained through the new telemetry path.
- [x] `form_start` is session-deduped from the first real form interaction, `register_click` is emitted on valid final submission, and the old submit-time `cta_click` inflation is removed. Historical CTA counts before this definition remain mixed and are not rewritten.
- [x] Public telemetry event types are exactly `page_view`, `cta_click`, `form_start`, and `register_click`; registration success remains the preregistration-row outcome used as the fifth ADMIN funnel stage.
- [x] `NOVELIGHT Production Migration Preflight` #678 / run `34845513447` was bound to exact main `21f9e581...`, observed exactly one pending migration (`20260914120000`), and passed the Production dry-run with `mutation: none`.
- [x] Issue #460 contains the exact one-time owner approval for main `21f9e581...`, migration set `["20260914120000"]`, challenge `B7D4A19C`, and a matching GitHub-Actions claim bound to bridge run `34845800411`.
- [x] `NOVELIGHT Approved Production Migration Deploy` #677 / run `34845800411` revalidated the exact pending set, reran the dry-run, applied only `20260914120000_beta_author_conversion_funnel.sql`, verified post-deploy migration status, passed Production beta observability, and recorded `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.
- [x] Fresh read-only Production DB verification confirms migration `20260914120000` is recorded, RLS remains enabled, the event constraint contains exactly the four funnel telemetry event types, and the hardened RPC retains advisory locking, dedupe, hourly cap, and service-role-only execution.
- [x] `public`, `anon`, and `authenticated` cannot execute the preregistration-event RPC; `service_role` can execute it.
- [x] PR #560 changes the public preregistration/ADMIN telemetry and supporting RPC/constraint but does not alter the authenticated novel-create / Geometry Thumbnail Engine / LIGHT ANALYTICS path exercised by Issue #511 / run `34692176490`.
- [x] Issue #511 remains still-valid only for that unchanged Chapter 38/40 authenticated scope; it is not treated as direct Production proof of the new preregistration funnel.
- [x] This documentation reconciliation performs no further Production DB/Supabase mutation, migration rerun, Stripe/billing/entitlement mutation, Secret/environment mutation, Production Auth Smoke, campaign-state cutover, or image generation/editing.
- [x] Qualified Japanese counsel review remains pending/deferred by owner and is not converted into legal PASS by the technical reconciliation.

## 2026-09-14 current-main reconciliation

The detailed checked evidence below is intentionally preserved for audit and regression-contract stability. Where an older line calls a 2026-09-13 proof “current”, the following newer reconciliation governs the present release decision.

- Current repository main is `69ed457c8a057fdb9fe69d05c03b078d164b370c` (`Fix per-work favorite conversion rate (#557)`).
- NOVELIGHT CI #2327, aggregate `check`, CodeQL #2234, and Vercel Production commit status are successful on/current to that merged state.
- Later beta-hardening now includes PR #539 reader auth-context continuity, PR #542 Chapter 41 LIGHT SEED-history smoke navigation alignment, PR #547 LIGHT READY beta checks, PR #549 trusted public impression receipts, PR #551 migration-safety artifacts, PR #553 public official-thumbnail lookup/Staging smoke fixes, PR #555 warning-gated work-detail-open analytics, and PR #557 per-work favorite conversion corrected to `favorites / impressions` with regression coverage.
- MASTER Chapter 41 remains authoritative: Work Rank is calculated internally but hidden from ordinary reader/author beta UI; unreleased SCOUT Level/Rank/badge/XP state remains locked; LIGHT SEED history stays separate and usable.
- Issue #511 / run `34692176490` remains still-valid only for its actually executed unchanged Chapter 38/40 authenticated create/render scope. It is not direct Production proof of the later Chapter 41/LIGHT READY/impression/public-thumbnail/analytics changes.
- Production Readiness #141 is retained as current-by-scope evidence and is not stretched into exact execution proof for every later analytics-only change.
- Production migration ledger evidence records `20260913112358` and `20260913141000` as already successful; neither is rerun here.
- Newest reconciled backup freshness evidence is Production Backup Freshness #65 / run `34829215089`.
- Qualified Japanese counsel review remains pending/deferred by owner.
- This reconciliation performs no Production DB/Supabase mutation, migration execution, Stripe/billing/entitlement mutation, Secret/environment mutation, freshness-only Production Auth Smoke, or image generation/editing.

## Git / CI

- [x] Latest `main` and authoritative release/evidence rules were re-fetched before reconciliation.
- [x] Material application SHA is `24df7347580c73648f31d6f4eaa7759689b228eb`; later docs-only reconciliation does not alter application state.
- [x] PR #530 exact approved head `010de41c10c3f7fe0a2eadad981b0eb087ba0365` passed `NOVELIGHT CI` #2243 / run `34702951293`.
- [x] PR #530 CI aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI jobs are successful.
- [x] Desktop + mobile Playwright gates pass for both smoke and async-UI coverage on PR #530 approved head.
- [x] PR #530 exact approved head passed `CodeQL` #2151 / run `34702951229`.
- [x] GitHub squash merge produced material application SHA `24df7347...` from the reviewed PR #530 content; the merge itself adds no additional application change beyond the approved PR diff.
- [x] Vercel Production commit status for material application SHA `24df7347...` is `success`.
- [x] `NOVELIGHT Production Readiness Smoke` #129 / run `34703260352` completed `success` on material application SHA `24df7347...`.
- [x] `production-readiness-smoke` commit status for material application SHA `24df7347...` is `success`.
- [x] No selectively skipped job is represented as executed.

The PR CI/CodeQL evidence above is not mislabeled as a separate main-push execution on the squash SHA. Application-SHA deployment and Production Readiness are independently recorded on `24df7347...`; later docs-only commits are audited as documentation changes rather than new application releases.

## Later launch-hardening changes after the authenticated Production proof

The successful Production Authenticated Smoke is SHA-bound to `e4e8673d6b45b046c69672a8e5fe72011c1a0081`. Later main commits were reviewed for whether they invalidate that proof under `docs/EVIDENCE-FRESHNESS-GATE.md`.

- [x] PR #513 gates the public `signup.html` UI during `PRE_REGISTRATION`, preserves the existing signup flow once enabled, and does not change the authenticated Chapter 38/40 product path, Production DB, migration, Storage, Secret, Stripe, entitlement, or Supabase Auth configuration.
- [x] PR #518 normalizes the public preregistration release label to `2026年9月30日`; campaign state remains database-driven and no Production mutation is introduced.
- [x] PR #517 updates ADMIN presentation/readability and the registered-user activity overview; it does not change ADMIN authentication/allowlist behavior, perform a migration, or destructively delete historical analytics rows.
- [x] PR #522 and PR #526 are residual/final ADMIN readability work and do not change the authenticated product path, Production database state, billing, or Supabase Auth configuration.
- [x] PR #523 adds an operator confirmation guard for campaign-state changes and aligns the ADMIN release-label placeholder to September 30; it does not change the Production schema or authenticated Chapter 38/40 flow.
- [x] PR #525 is documentation-only and records the September 30 campaign cutover, verification, and rollback procedure.
- [x] PR #528 makes the preregistration ADMIN truthful that `invited` is a record of externally completed outreach; it does not add mail/DM infrastructure or change Auth, billing, or Production data automatically.
- [x] PR #530 adds author-onboarding guidance to `signup.html`: beta Standard is free/cardless and self-service through pricing, and confirmed authors can continue from 「創作室」. The existing `auth.signUp()` call, `/index.html` email redirect, billing API, DB, Stripe, Secret, and entitlement logic are unchanged.
- [x] None of PRs #513/#518/#517/#522/#523/#525/#526/#528/#530 changes the authenticated novel-create / Geometry Thumbnail Engine / LIGHT ANALYTICS path exercised by Issue #511 / run `34692176490`.
- [x] The #511 Production Authenticated Smoke is therefore retained as **still-valid scope proof**, not relabeled as execution on material application SHA `24df7347...`.
- [x] A post-merge `NOVELIGHT Production Auth Smoke Request` workflow may create a request record for a newer SHA; request-only workflow success is **not** authenticated Production PASS evidence and does not supersede Issue #511 without the required owner approval, decisive verification job, and consumed ledger record.
- [x] No duplicate Production Auth Smoke is run solely to make the documentary proof SHA equal current repository `main`.

## Official thumbnail launch dependency

The 2026-09-10 release reconciliation correctly blocked launch while Production had no active official thumbnail. That historical blocker has now been cleared.

- [x] Official-thumbnail schema and privilege hardening remain part of Production state.
- [x] The launch official-thumbnail catalog is populated through the existing ADMIN path.
- [x] Production Readiness #129 on material application SHA `24df7347...` passes, preserving the deterministic `active_official_thumbnails_present=true` launch prerequisite and the remaining integrity checks.
- [x] New-novel creation using the official thumbnail flow was exercised by the still-valid authenticated Production smoke on `e4e8673d...`.
- [x] Chapter 40 geometry thumbnail render/composition persistence was exercised by the same authenticated Production flow.
- [x] No later reviewed change invalidates that create/render/composition proof.
- [x] No placeholder-only asset is being used merely to force the readiness gate to pass.

The old 0-row / 0-active-row Production inspection remains historical evidence only. It must not be reused as current state after the successful readiness proof.

## Supabase Production

Previously reconciled Production migrations through `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` remain part of current Production state.

Chapter 38 Production state remains reconciled:

- [x] `20260909071500_scout_beta_event_foundations.sql` and `20260909071510_scout_beta_rules_rls.sql` are covered by issue #165 / bridge run `34315738396`, mutation/postcheck `success`.
- [x] `20260909080000_disable_light_seed_v1_client_rpcs.sql` was applied during the Chapter 38 Production rollout and is not repeated for documentary freshness.
- [x] `20260909100000_chapter38_work_rank_engine.sql` was applied during the Chapter 38 Production rollout and is not repeated for documentary freshness.
- [x] `20260909120000_chapter38_work_rank_lifecycle.sql` is covered by issue #165 / bridge run `34335400168`, mutation/postcheck `success`.
- [x] `20260909130000_chapter38_rank_bayesian_percentiles.sql` is covered by issue #165 / bridge run `34340585331`, mutation/postcheck `success`.
- [x] `20260909140000_chapter38_seed_discovery_exp.sql` is covered by issue #165 / bridge run `34358566221`, mutation/postcheck `success`.
- [x] `20260909190000_chapter38_star_rating_scout_exp.sql` is covered by issue #460 / bridge run `34408554615`, `result="success"`, mutation/postcheck `success`.
- [x] `20260910070000_chapter38_comment_scout_exp_foundation.sql` is covered by issue #460 / bridge run `34413902759`, `result="success"`, mutation/postcheck `success`.
- [x] `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` is covered by issue #460 / bridge run `34441780108`, `result="success"`, mutation/postcheck `success`.

Chapter 40 / official-thumbnail registration state:

- [x] PR #490 introduced `20260911123000_fix_thumbnail_asset_registration_path.sql` to fix the valid official-thumbnail Storage-path registration boundary.
- [x] `20260911123000_fix_thumbnail_asset_registration_path.sql` is already applied in Production and is treated as current state.
- [x] The migration is **not** rerun for documentary freshness or release reconciliation.
- [x] PRs #513/#518/#517/#522/#523/#525/#526/#528/#530 introduce no Production migration requirement.
- [x] No Production database mutation is performed by this reconciliation.

## Chapter 38 beta behavior

- [x] Replayable SCOUT event/EXP ledger foundations exist.
- [x] Valid-read sessions/events and reader-side heartbeat/progress signaling are implemented.
- [x] LIGHT SEED send-time Rank/event attribution is implemented.
- [x] Work Rank engine/history/lifecycle and percentile logic are implemented.
- [x] 180-day discovery EXP is implemented.
- [x] Star-rating EXP is implemented.
- [x] Comment EXP and self-comment exclusion are implemented.
- [x] ADMIN beta analysis support is implemented.
- [x] Beta UI does not expose SCOUT Level, Rank, badges, EXP, or unreleased SCOUT RECORD mechanics.
- [x] LIGHT SEED send history is presented separately from unreleased SCOUT RECORD.
- [x] The materially changed authenticated Chapter 38 boundary retains a successful, still-valid approval-gated Production Authenticated Smoke: Issue #511 / run `34692176490` on `e4e8673d...`.

## Chapter 40 Geometry Thumbnail Engine

- [x] `base_book + cover_quad` remains the Source of Truth.
- [x] PNG masks remain debug-only and are not the rendering authority.
- [x] `cover_texture` / `pattern` / `symbol` / `frame` are rendered through Perspective Transform.
- [x] `effect` may render outside the cover only through template configuration.
- [x] Geometry Validation remains mandatory.
- [x] ADMIN four-point drag editing, numeric input, and real-time preview remain the authoring boundary.
- [x] The shared Geometry Engine remains the basis for all official templates, with future `spine_quad` / `page_quad` / `edge_quad` extension points.
- [x] Production-authenticated novel creation, thumbnail render, and composition persistence passed on the still-valid proof SHA `e4e8673d...`.
- [x] Render-output cleanup completed after the smoke; temporary smoke state was not retained as launch content.
- [x] Later PRs through #530 do not modify the Geometry Thumbnail Engine create/render/composition path.

## Production Authenticated Smoke — still-valid scope proof

Newest successful Production Authenticated Smoke for the authenticated Chapter 38/40 beta-critical path:

- [x] Dedicated approval issue: #511.
- [x] Exact approved/head main: `e4e8673d6b45b046c69672a8e5fe72011c1a0081`.
- [x] OWNER approval is recorded on the dedicated request.
- [x] Approval was claimed once and bound to run `34692176490`.
- [x] Workflow is `NOVELIGHT Production Auth Smoke Approval Handler` on the required `issue_comment` path.
- [x] Decisive `Verify authenticated beta-critical production flows` job completed `success`.
- [x] Desktop and mobile authenticated smoke passed.
- [x] Chapter 40 official-thumbnail / geometry thumbnail creation-render-persistence flow passed.
- [x] LIGHT ANALYTICS smoke passed.
- [x] Ephemeral Production smoke-data cleanup succeeded.
- [x] Temporary Production credentials / fixture cleanup succeeded.
- [x] The dedicated issue contains exactly one matching GitHub-Actions-authored `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED` record for run `34692176490`, main `e4e8673d6b45b046c69672a8e5fe72011c1a0081`, `result="success"`.
- [x] Issue #511 is closed after consumption.
- [x] No Stripe live charge was created by the smoke.
- [x] Under evidence-freshness review, later launch-hardening PRs through #530 do not invalidate this proof scope.
- [x] This smoke remains explicitly SHA-bound to `e4e8673d...`; it is reused only as still-valid unchanged-scope proof and is not relabeled as execution on the later material application SHA.

Historical failed attempts #472 and #474 remain recorded as failures with successful cleanup. They are not rewritten as PASS; the newer successful proof supersedes them for the unchanged authenticated scope.

## Discovery / LIGHT ANALYTICS / posting / author home

- [x] Existing Free/Standard/Premium discovery behavior remains covered by current or still-valid evidence.
- [x] Trusted allocation receipts and server-authoritative PV counting remain part of Production state.
- [x] Official thumbnail schema/privilege hardening remains part of Production state.
- [x] Production has an active official-thumbnail path; Production Readiness #129 on material application SHA `24df7347...` remains green.
- [x] New-novel submission completed in the still-valid authenticated smoke on `e4e8673d...`.
- [x] LIGHT ANALYTICS passed in that same still-valid authenticated smoke.
- [x] Beta Standard entitlement activation required by the analytics smoke remains present through PR #510 and is not changed by later launch-hardening PRs through #530.
- [x] PR #530 clarifies the existing beta Standard self-service activation path without moving entitlement activation into signup.
- [x] Author-home public profile/avatar/recent-activity boundary remains part of Production state.
- [x] PR #530 approved-head CI covers reader/author UI regression scope before the squash merge.

## Preregistration / first-author operations

- [x] Public preregistration campaign state is database-driven and the server-side submission boundary accepts new preregistration only in `PRE_REGISTRATION`.
- [x] ADMIN campaign-state changes require an explicit operator confirmation when the state changes.
- [x] The September 30 launch procedure uses the authenticated ADMIN transition `PRE_REGISTRATION -> BETA_OPEN`, not direct Production SQL.
- [x] ADMIN `invited` represents externally completed outreach recorded manually; ADMIN itself does not send email or DM.
- [x] `registered_at` / 「本登録済み」 and `first_novel_at` / 「初投稿済み」 remain operator-confirmed conversion milestones; preregistration/outreach alone does not prove them.
- [x] Current preregistration status handling is not represented as automatic prereg-email-to-Auth matching.
- [x] Beta Standard remains self-service from pricing (`Standardを無料で利用`) and requires no card during the beta; ordinary activation does not require manual Stripe or Production DB edits.
- [x] Founding Authors eligibility is not manually reserved from preregistration order; the qualifying real-author publication flow determines eligibility.
- [x] `docs/BETA-OPERATIONS-RUNBOOK.md` records these onboarding/milestone rules and prohibits copying preregistration PII into GitHub/chat evidence.

## Content / moderation / ADMIN

- [x] AI-use classification and mature-content warning requirements remain in place.
- [x] Report submission/privacy and operator workflow remain covered by prior current/still-valid evidence.
- [x] ADMIN remains server-side authenticated/allowlisted under the existing boundary.
- [x] Chapter 38 ADMIN beta analytics has repository coverage.
- [x] PR #517/#522/#526 change ADMIN theme/readability without changing ADMIN authentication/allowlist behavior.
- [x] PR #523 adds a campaign-state confirmation guard without changing the authorization boundary.
- [x] PR #528 makes manual outreach recording explicit and does not add automated messaging infrastructure.
- [x] Vercel Production and Production Readiness #129 are green on material application SHA `24df7347...` after PR #530.
- [x] Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Backup / restore — hard GO gate

- [x] Production Supabase scheduled-backup posture remains established.
- [x] `NOVELIGHT Production Backup Freshness` #8 / run `33354249864` remains the newest accepted read-only backup freshness proof.
- [x] Non-Production restore rehearsal remains recorded.
- [x] No reviewed Chapter 40 / signup-gate / release-label / ADMIN / onboarding-copy change modifies the backup/restore control boundary.
- [x] Production restore is not repeated for documentary freshness.

## Beta pricing / Production billing

- [x] Standard beta pricing remains `0円` without required credit-card registration.
- [x] Standard beta entitlement remains self-service through the pricing action; PR #530 only clarifies that existing path.
- [x] Premium beta special pricing remains `月額480円`.
- [x] Premium regular/formal price remains `月額1,980円`.
- [x] `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` remains the decisive live billing proof.
- [x] Later launch-hardening PRs through #530 do not require a new Stripe live operation for this reconciliation.
- [x] Stripe live operations are not repeated solely for documentary freshness.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain public release surfaces.
- [x] Public preregistration release labeling follows the MASTER date `2026年9月30日`.
- [x] Signup now explains the beta Standard/cardless activation path and post-confirmation 「創作室」 continuation without changing the Auth redirect or entitlement logic.
- [x] Vercel Production and Production Readiness #129 pass on material application SHA `24df7347...`; PR #530 approved-head CI/CodeQL passed before squash merge.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded.**

## Final release gate

- [x] Material application main is `21f9e581f4009303904067d18bc5bea05c641d43` at this reconciliation; later docs-only commits do not change deployable application behavior.
- [x] PR #560 final reviewed head `dec5fcbabf7ce169386a16bd03d4a7907d83a149` passed `NOVELIGHT CI` #2333 and CodeQL #2239; Vercel Production, Production Readiness #142, and `production-beta-verification` pass on the merged material application SHA.
- [x] Production migration `20260914120000_beta_author_conversion_funnel.sql` is applied and recorded through Issue #460 / deploy run `34845800411` with mutation/postcheck success and fresh read-only Production DB verification.
- [x] Production migration ledger/state, billing, backup, and unchanged operational boundaries have supportable current/still-valid evidence.
- [x] The former empty-official-thumbnail blocker remains cleared by Production Readiness on the current material application SHA.
- [x] The successful approval-gated Production Authenticated Smoke on `e4e8673d...` remains still-valid only for the unchanged authenticated Chapter 38/40 boundary after review of PR #560 scope.
- [x] Chapter 40 Production-authenticated create/render/composition persistence verification remains valid for that unchanged scope.
- [x] Cleanup and matching consumed-approval evidence are complete.
- [x] A request-only Auth Smoke workflow for a newer SHA is not treated as authenticated PASS and does not require approval solely for documentary SHA freshness.
- [x] No duplicate Production mutation or Auth Smoke is required merely to refresh documentary SHA alignment.

**Release posture after 2026-09-14 post-PR #560 reconciliation: GO.**

This GO means the technical/operational release blockers tracked by this checklist are satisfied on current and specifically justified still-valid evidence. It does not convert the still-pending qualified Japanese counsel review into a legal PASS, and it does not authorize repeating already-completed Production migrations, smoke fixtures, Stripe operations, Secret changes, or other Production mutations.