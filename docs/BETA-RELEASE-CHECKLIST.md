# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-22 JST.**


## 2026-09-22 post-PR #806 full-audit reconciliation

This section records the repository-wide read-only audit performed after PR #806 reached Production. It supersedes older "current main" wording where the scope overlaps; older evidence remains historical.

- [x] Audited material application baseline is `ae89fec6b6d344cdceff48f3bfbb6b61cf1c774b` (PR #806, `Strengthen author post-publish management path`).
- [x] PR #806 final reviewed head `67c87ad06a05c32c0dcd20d06ee9f3742634468b` and merged main `ae89fec...` have the identical Git tree `2a297791021f0902543b98f68ebb14c26c3a1f5e`; reviewed-head CI therefore covers the exact merged file content.
- [x] PR #806 `NOVELIGHT CI` run `35698654726` succeeded: 1,146/1,146 Node tests, static quality, desktop/mobile smoke (26/26 each), desktop/mobile async-UI (38/38 each), and aggregate `check`.
- [x] PR #806 CodeQL run `35698654794` succeeded.
- [x] Final authenticated Staging smoke run `35698714196` succeeded for desktop, mobile, cleanup, and Stripe test checkout/entitlement/portal/cancellation; Staging Live Proof run `35698714172` succeeded.
- [x] Merged main `ae89fec...` reports `Vercel: success` and `production-readiness-smoke: success`; Production Readiness run `35701176054` succeeded.
- [x] Latest observed Production Backup Freshness run `35670990177` succeeded; newest completed backup was 3.16 hours old against a 36-hour limit.
- [x] Latest observed scheduled Production Billing Guard run `35660233460` succeeded with `issueCodes=[]`, `warningCodes=[]`, and no approval-requiring remediation.
- [x] Latest observed Beta Ops Inbox Watch run `35688886965` succeeded with 0 new content reports and 0 new contact inquiries.
- [x] Fresh open-issue searches found no open `bug` or explicit `beta blocker`; Issue #200 remains the launch-control issue.
- [x] 31 obsolete/request-only Production Auth Smoke approval issues were closed as not planned. No successful consumed Auth Smoke evidence or active Approval Ledger was removed.
- [x] Clearly superseded stale feature/audit PRs #247, #297, #358, #413, #415, #476, #487, #618, #622, #623, and #624 were closed. Dependency-update PRs remain separate and are not treated as beta-launch work.
- [x] No Production Auth Smoke, migration, DB/RLS mutation, Stripe live mutation, Secret/env change, or campaign-state mutation was executed for this audit.
- [ ] PR #808 contains the preregistration copy fix that removes the obsolete promise to email participation instructions. It is not Production evidence until separately approved and merged.
- [ ] 2026-09-28 `PRE_REGISTRATION -> AUTHOR_PREOPEN` remains a future gate and is not executed or pre-authorized here.
- [ ] 2026-09-29 content-inventory / first-reader-path remains a future read-only gate and must not be run early.
- [ ] 2026-09-30 `AUTHOR_PREOPEN -> BETA_OPEN` remains a future launch mutation and is not executed or pre-authorized here.
- [ ] Qualified Japanese counsel review remains deferred/pending under the recorded owner residual-risk decision.

**Full-audit verdict:** no new non-deferred technical beta blocker was identified on the audited material application baseline. The temporary no-mail Auth ownership-verification limitation remains an explicitly accepted beta operational risk; it is not converted into a stronger identity-verification claim.


## 2026-09-22 post-9/20 material feature-chain reconciliation

This section records the broad current-state evidence for material beta work merged after the last final-audit baseline. It complements, and does not rerun, the separate beta no-mail Auth reconciliation below.

- [x] Live repository `main` at reconciliation is `08142bd2c89f3bdec3cc83cb9fd971932ce66b00` (PR #803, docs-only); material application baseline remains PR #800 at `484f13880af1f7a9aa95374eb9b93e5f3a9e9ef3`.
- [x] Material-main commit statuses remain `Vercel: success` and `production-readiness-smoke: success`.
- [x] PRs #733, #735, #740, #742, #744, #748, #750, #766, #770, #776, #778, #780, #782, #784, #791, #793, #794, #796, and #800 each have successful PR-head `NOVELIGHT CI` and `CodeQL` evidence.
- [x] Production migrations `20260920122000`, `20260920152733`, `20260920082032`, `20260920093847`, `20260920204000`, `20260920221000`, `20260920223049`, `20260921022608`, `20260921025328`, `20260921063000`, and `20260921120552` all have matching Approval Ledger `EXECUTED` records with successful mutation and postcheck results.
- [x] The feature-chain scope includes Founding/Beta qualification, Free two-work limit, episode hearts, inline illustrations, thumbnail geometry/material handling, official tags, SCOUT RECORD core/badges/KPI/navigation, beta bulk episode import, official background batch import, and private account-settings work now present on current main.
- [x] Fresh open-issue searches for beta blocker/P0/P1/preopen/launch identify Issue #200 as the active launch-control item; no current open `bug` issue was returned. Generated approval-request/ledger issues are audit/control records, not new product blockers.
- [x] Evidence-freshness verdict for the already-executed feature-chain migrations and PR #800 Auth work is `current`; do not rerun them for timestamp or SHA alignment.
- [ ] 2026-09-28 `PRE_REGISTRATION -> AUTHOR_PREOPEN` remains a future gate and is not executed or pre-authorized by this reconciliation.
- [ ] 2026-09-29 content-inventory / first-reader-path remains a future read-only gate and must not be run early.
- [ ] 2026-09-30 `AUTHOR_PREOPEN -> BETA_OPEN` remains a future launch mutation and is not executed or pre-authorized by this reconciliation.

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

The **current material application baseline at this reconciliation** is `484f13880af1f7a9aa95374eb9b93e5f3a9e9ef3` (PR #800, `Add temporary beta no-mail Auth mode`). Exact-main Vercel and `production-readiness-smoke` statuses are `success`, and the approval-gated Production Authenticated Smoke converged on the same SHA. Live `main` must still be resolved again at each future cutover under `docs/EVIDENCE-FRESHNESS-GATE.md`.

**CURRENT FINAL-AUDIT POSTURE: the backup/restore recovery blocker and the temporary beta no-mail Auth prerequisite are CLEARED. Exact current main `484f13880af1f7a9aa95374eb9b93e5f3a9e9ef3` has successful Vercel/readiness status; approval-gated Auth-mode run `35686483637` and Production Authenticated Smoke run `35686551395` both completed successfully with matching consumed evidence. Current `PRE_REGISTRATION` operation is technically healthy. Future 2026-09-28/29/30 operational cutovers remain separately gated and are not pre-authorized. Qualified Japanese counsel review remains deferred/pending under the recorded owner residual-risk decision.**

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision is recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## 2026-09-22 current-main / post-PR #800 beta no-mail Auth reconciliation

This section supersedes older current-state Auth/email-delivery wording where the scope overlaps.

- [x] Exact current repository/material application main is `484f13880af1f7a9aa95374eb9b93e5f3a9e9ef3` (PR #800, `Add temporary beta no-mail Auth mode`).
- [x] Exact-main commit statuses report `Vercel: success` and `production-readiness-smoke: success`.
- [x] Approval Ledger #737 records the exact run `35686483637` as consumed successfully with `changed:true`, `postcheck:"success"`, and `targetAutoconfirm:true`.
- [x] Run `35686483637` completed the scoped Production Auth mutation and verification successfully; its rollback/failure paths were skipped.
- [x] Production Authenticated Smoke Issue #801 / run `35686551395` completed the decisive `Verify authenticated beta-critical production flows` job successfully, cleaned ephemeral smoke data, and recorded matching `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED ... result:"success"` evidence.
- [x] Duplicate-attempt run `35688394269` failed at the one-time approval-validation step before any Production Auth mutation; checkout, claim, mutation, verification, and consumed-record steps were all skipped.
- [x] Mail-dependent email-address change and password-recovery UI remain paused under PR #800 until a verified transactional mail-delivery path exists.
- [x] The temporary beta no-mail Auth prerequisite for 2026-09-28 is satisfied. Do not repeat the Auth-mode mutation or Auth Smoke merely for timestamp/SHA freshness.
- [ ] 2026-09-28 `PRE_REGISTRATION -> AUTHOR_PREOPEN` cutover is complete. **Future operational gate; not yet due and not pre-authorized.**
- [ ] 2026-09-29 content-inventory / first-reader-path gate is complete. **Future operational gate; do not run early.**
- [ ] 2026-09-30 `AUTHOR_PREOPEN -> BETA_OPEN` transition is complete. **Future launch operation; not pre-authorized.**
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded and is not converted into legal PASS.**

## 2026-09-20 current-main / post-PR #721 final-audit reconciliation

This section supersedes older “current”, backup/restore-hard-gate, and final launch-posture wording below where the scope overlaps.

- [x] Exact current repository/application baseline verified as `c9eaefd9baa941d2f20699a29c8e9ac233b64196` (PR #721).
- [x] PR #717 final head `2c9b071fbe5ea142878edbdfdff0c1e5b17a4b17` passed `NOVELIGHT CI` run `35440178759` and CodeQL run `35440178750`.
- [x] PR #717 Production migration `20260919195300_beta_final_fairness_hardening` was approval-gated and successfully applied/postchecked by run `35441674693`.
- [x] No migration was added after PR #717 through current baseline `c9eaefd...`.
- [x] PR #719 final head `02108c183f0689d3c6a0b81eedb2641c88099ba8` passed `NOVELIGHT CI` run `35442916297` and CodeQL run `35442916268`.
- [x] PR #721 final head `950df03811373b747797545e857857e1d63f6897` passed `NOVELIGHT CI` run `35444779942` and CodeQL run `35444779938`.
- [x] Live `/api/deployment-revision` returned exact `c9eaefd9baa941d2f20699a29c8e9ac233b64196`.
- [x] Live public campaign lookup returned `PRE_REGISTRATION` and release label `2026年9月30日`.
- [x] Production Readiness run `35445379573` completed all decisive read-only verification steps successfully.
- [x] Production Authenticated Smoke Issue #723 / run `35449741256` is exact-current, completed authenticated beta-critical flows successfully, cleaned ephemeral data, and recorded matching consumed approval.
- [x] Production Billing Health run `35449744107` reported current guard version, `issueCodes=[]`, `warningCodes=[]`, and no approval-requiring remediation.
- [x] Stripe live bootstrap/control run `33612120034` remains still-valid for the unchanged decisive checkout/webhook/portal boundary; no duplicate live Stripe operation is required.
- [x] Production Backup Freshness run `35445231639` passed; latest completed Production backup was 16.21 hours old against a 36-hour maximum.
- [x] The 2026-08-23 restore rehearsal remains valid historical proof for provider restore and Auth/profiles/novels/episodes recovery.
- [x] A fresh non-Production/disposable restore rehearsal was completed on 2026-09-20 JST from the `2026-09-18T21:03:30Z` Production backup. Ten later repository migrations were replayed only on the disposable target, `supabase/checks/restore_validation.sql` passed, representative author/reader RLS/privacy checks and core RPC checks passed, Auth/profile/password-hash and billing-state restoration were confirmed, and the disposable project was deleted after verification.
- [x] Provider recovery boundary is reconciled: Supabase Restore-to-New-Project transfers Auth identity/hash records but does not copy hosted Auth settings/API keys. The runbook now treats those project-level values as explicit recovered-service reconfiguration, with existing-user sign-in and password-recovery verification required **before service reopen**, not as database-backup content that must already be intact on an unconfigured disposable clone.
- [x] Current-worktree `npm run preflight:fast` passes with 995 tests / 989 pass / 0 fail / 6 skip.
- [x] Current-worktree full Playwright suite passes 170/170 across desktop/mobile.
- [x] Temporary beta no-mail Auth mode is deployed and Production-postchecked as of 2026-09-22 on exact main `484f13880af1f7a9aa95374eb9b93e5f3a9e9ef3`: Auth-mode run `35686483637` and Production Authenticated Smoke run `35686551395` succeeded with matching consumed evidence; mail-dependent email-change/password-recovery UI remains paused until a verified delivery path exists. **Required before the 2026-09-28 author preopen while no verified mail-delivery path exists; this prerequisite is now satisfied.**
- [ ] 2026-09-28 `PRE_REGISTRATION -> AUTHOR_PREOPEN` cutover has been explicitly approved and executed. **Future operational gate; not yet due and not pre-authorized.**
- [ ] 2026-09-29 content-inventory / first-reader-path gate is complete. **Future operational gate. Execute the read-only `NOVELIGHT Beta Inventory First Reader Gate` workflow and record the aggregate counts, anonymous reader-path result, and owner inventory-breadth decision under `docs/BETA-OPERATIONS-RUNBOOK.md`.**
- [ ] 2026-09-30 `BETA_OPEN` transition has been explicitly approved and executed. **Future launch operation; not pre-authorized.**
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded and is not converted into legal PASS.**

**Release posture after the 2026-09-20 restore rehearsal: the backup/restore hard gate is PASS and the recovery blocker is cleared. Current preregistration operation remains technically healthy. This does not execute or pre-authorize the future `AUTHOR_PREOPEN`, 2026-09-29 inventory/first-reader-path gate, or `BETA_OPEN` transition, and it does not convert deferred qualified-counsel review into legal PASS.**

## 2026-09-19 current material application / post-PR #714 beta-audit remediation reconciliation

This section supersedes older “current”, “material application main”, migration-freshness, and final release-posture wording below where the scope overlaps. Older checked evidence remains preserved for audit/regression history.

- [x] Material application baseline is `613e804a943d06c0e2a46ab0cc2f12a6a2ad5cad` (`Harden beta launch fairness and spoiler boundaries (#714)`).
- [x] PR #714 final reviewed head is `7aea8cad3cc197aabd75996fb53559fc2ee8b2c1`.
- [x] After exact-head owner approval, `NOVELIGHT CI` run `35433932164` completed Merge readiness, RLS integration/rollback, Static quality, Node tests, desktop/mobile smoke, desktop/mobile async-UI, and aggregate `check` with `SUCCESS`.
- [x] `Beta P0 Database Gate` run `35433932205` completed `SUCCESS`.
- [x] CodeQL run `35433932168` completed `SUCCESS`.
- [x] Vercel Production is converged on `613e804a...`; live `/api/deployment-revision` returned the exact full SHA `613e804a943d06c0e2a46ab0cc2f12a6a2ad5cad`.
- [x] `NOVELIGHT Production Readiness Smoke` run `35434084396` completed `SUCCESS`.
- [x] Read-only Production Migration Preflight run `35434304517` completed `SUCCESS` and the repository-vs-Production comparison showed exactly the approved three pending migrations with no unexpected remote-only version.
- [x] Approval Ledger #657 contains exact owner approval for operation `supabase-migration-deploy`, main `613e804a...`, challenge `613E804A`, and migration set `["20260919165000","20260919170000","20260919171500"]`.
- [x] Approved Production migration deploy run `35434518539` revalidated the claimed approval and pending set, passed the dry-run, applied only the approved three migrations, verified post-deploy migration status, and passed Production beta observability.
- [x] Approval Ledger #657 records the matching `CLAIMED` and `EXECUTED` entries for run `35434518539` with `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, and `failure_phase="none"`.
- [x] Production migration history now includes `20260919165000_beta_audit_rank_fairness`, `20260919170000_beta_preopen_launch_clock`, and `20260919171500_spoiler_safe_episode_metadata`; no later repository migration is pending at this reconciliation.
- [x] Fresh read-only Production verification confirms the legacy raw-PV ranking RPC is closed to `anon`/ `authenticated`, the v2 ranking feed is available, Work Rank uses qualified valid-read evidence, the discovery launch-clock helper is active, and spoiler-safe episode metadata RPCs are present and wired to valid-read evidence.
- [x] The beta-audit ranking manipulation blocker is remediated in Production.
- [x] Founding-author preopen works use the 2026-09-30 launch-relative benefit clock without rewriting their real publication timestamps.
- [x] Automatic outline/update/continuity surfaces no longer pre-expose unreached future episode titles on the audited paths.
- [x] Production campaign state remains `PRE_REGISTRATION`; the future `PRE_REGISTRATION -> AUTHOR_PREOPEN` cutover is not treated as completed and remains separately approval-gated.
- [x] The post-2026-09-16 migration reconciliation now covers 26 versions through `20260919171500`.
- [x] No remaining non-deferred technical/operational launch blocker from the beta-audit remediation is open.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded and is not converted into legal PASS.**

**Release posture after PR #714 / beta-audit remediation: GO for the presently executable technical/operational state.** This does not authorize the future `AUTHOR_PREOPEN` or public-beta campaign-state transitions. The planned 2026-09-29 content-inventory / first-reader-path gate remains future operational work while Production intentionally remains in preregistration.

## 2026-09-19 current-main / post-PR #711 preopen reconciliation

This section supersedes older “current”, “material application main”, and final release-posture wording below where the scope overlaps. Older checked evidence remains preserved for audit/regression history.

- [x] Fresh repository `main` and current material application SHA are both `db7ad9aa79aae8fe79b792762efb61cdb92130e5` (`Add founding author preopen access gate (#711)`).
- [x] PR #711 final reviewed head is `7825ca0f2a53ebe3fea390281c979533d05eb9f0`.
- [x] After exact-head owner approval, `NOVELIGHT CI` #2670 / run `35426432255` completed with Merge readiness, RLS integration/rollback, Static quality, Node tests, desktop/mobile smoke, desktop/mobile async-UI, and aggregate `check` all `SUCCESS`.
- [x] PR #711 CodeQL #2569 / run `35426432301` completed `SUCCESS`.
- [x] Exact merged main `db7ad9aa...` has Vercel Production status `success`.
- [x] `NOVELIGHT Production Readiness Smoke` #208 / run `35426613014` completed `SUCCESS` on exact current main; `production-readiness-smoke` commit status is `success`.
- [x] Read-only Production migration preflight #888 / run `35426646796` was bound to exact main `db7ad9aa...`, observed exactly one pending migration (`20260919151044`), and the dry-run would push only `20260919151044_beta_author_preopen_access.sql`.
- [x] Approval Ledger #657 records the exact owner approval for operation `supabase-migration-deploy`, main `db7ad9aa...`, challenge `DB7AD9AA`, and migration set `["20260919151044"]`, followed by the matching CLAIMED record for bridge run `35426789881`.
- [x] Approved Production migration deploy #887 / run `35426789881` revalidated current main and the exact singleton pending set, repeated the dry-run, applied only `20260919151044_beta_author_preopen_access.sql`, and completed all deploy/postcheck jobs successfully.
- [x] Post-deploy migration status shows `20260919151044` in both Local and Remote with no remaining pending migration.
- [x] Production beta integrity/observability checks passed and the `production-beta-verification` commit status is `success`.
- [x] Approval Ledger #657 records `EXECUTED` for challenge `DB7AD9AA` with `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, and `failure_phase="none"`.
- [x] Read-only Production SQL verification confirms campaign state is still `PRE_REGISTRATION`, the state constraint includes `AUTHOR_PREOPEN`, the Auth lookup policy is present, Auth admin read access is limited to `email_normalized` and `status`, client roles do not gain raw preregistration SELECT, and the signup hook contains `AUTHOR_PREOPEN` handling without client EXECUTE privileges.
- [x] The 2026-09-28 `PRE_REGISTRATION -> AUTHOR_PREOPEN` transition is not treated as completed. It remains a future, separately approval-gated campaign cutover under `docs/BETA-OPERATIONS-RUNBOOK.md`.
- [x] No live Production `AUTHOR_PREOPEN` signup E2E is claimed while Production remains `PRE_REGISTRATION`.
- [x] The competitor audit #1–#24 remains fully implemented; PR #711 does not reopen it.
- [x] The post-2026-09-16 migration reconciliation now covers 23 migration versions; the newest `20260919151044` is successfully applied and postchecked.
- [x] No new non-deferred technical/operational launch blocker was found after PR #711 and its Production migration.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded and is not converted into legal PASS.**

**Release posture after PR #711 / Production preopen-migration reconciliation: GO.** This is a technical/operational classification based on current and specifically still-valid evidence. It does not authorize the future `AUTHOR_PREOPEN` campaign cutover and does not make a legal-sufficiency finding.

## 2026-09-19 current-main / post-competitor-audit reconciliation

This section supersedes older “current”, “material application main”, and final release-posture wording below where the scope overlaps. Older checked evidence remains preserved for audit/regression history.

- [x] Fresh repository `main` is `1c1d9af5e9a4100ba054119a4d59b3a05d24af74`; the exact diff from material application SHA `33fe909c04ac108f763f83b2b82ebf158f3ef263` is docs-only.
- [x] PR #705 final head `9c7bcfe5df47e7da76e2d698f1e3dd3930b1ec3c` passed `NOVELIGHT CI` #2662 / run `35421729769`: Merge readiness, Static quality, Node tests, desktop/mobile smoke, desktop/mobile async-UI, and aggregate `check` are successful.
- [x] PR #705 CodeQL #2563 / run `35421729766` completed `SUCCESS`.
- [x] Merged material application SHA `33fe909c...` has Vercel Production and `production-readiness-smoke` statuses `success`.
- [x] PR #707 is docs-only; final head `74d8387788cce4c610c0172f560f64edb6486cdc` passed `NOVELIGHT CI` #2664 / run `35423088099` and CodeQL #2565 / run `35423088105`, while current `main` has Vercel Production status `success`.
- [x] The 2026-09-16 competitor audit #1–#24 is fully implemented on current `main`; no formal #25 exists and no speculative #25 is treated as a beta requirement.
- [x] Exactly 22 migration files were added between the prior post-#609 evidence baseline `a7bd226a...` and current `main`.
- [x] Approval Ledger #460 has successful mutation/postcheck execution evidence for `20260917020000` and `20260917123000`.
- [x] Approval Ledger #657 has successful mutation/postcheck execution evidence for the 18 versions from `20260917150000` through `20260919122554` listed in the matching release-evidence reconciliation.
- [x] PR #632 records `20260917074632_episode_revision_history` as the exact Production-applied version and aligns repository history without changing SQL behavior.
- [x] PR #636 records `20260917084123_episode_revision_fk_indexes` as already applied successfully in Production with formal postcheck success and aligns repository history without changing SQL behavior.
- [x] Latest approved Production migration deploy run `35420162111` completed validation, mutation, and result-recording jobs successfully; its execution required the exact pending set, dry-ran it, applied `20260919122554`, verified migration status, passed Production beta observability, and published successful Production beta verification.
- [x] The post-deploy list in run `35420162111` shows `20260919122554` present in both Local and Remote; PR #705 and PR #707 add no later migration.
- [x] Existing Production Authenticated Smoke Issue #511 / run `34692176490` remains scope-limited to the authenticated Chapter 38/40 create/render/LIGHT ANALYTICS flow; it is not relabeled as proof of later competitor-audit features.
- [x] No duplicate Production migration, Auth Smoke, Stripe operation, Secret mutation, or campaign-state cutover is required merely to refresh documentary SHA alignment.
- [x] No new non-deferred technical/operational launch blocker was found in the 2026-09-19 reconciliation.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded and is not converted into legal PASS.**

**Release posture after 2026-09-19 current-main reconciliation: GO.** This is a technical/operational classification based on current and specifically still-valid evidence. It does not authorize any Production mutation and does not make a legal-sufficiency finding.

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