# NOVELIGHT public-beta release evidence — 2026-08-23

This file records observed release evidence. It is not a substitute for the checklist, legal advice, or future re-verification after material production changes.

## Release code and automated gates

- Main remediation PR #48 was merged as `0f56b1c27aaac92918031a33048aabd805e2104e`.
- Signup display-name persistence PR #49 was merged as `cb5f39f307fcee924e8cf89398ce31e6324c80de`.
- Production beta observability automation PR #50 was merged as `14c22d30925b0f7071eb4fa47042a09f5c74f799`.
- Production verification commit-status reporting PR #51 was merged as `287d09fc79df3b4cf84708dfca5fbdec3aeef858`.
- Beta moderation/support inbox automation PR #52 was merged as `bf83a4e3d6e2398b27faedbd83e320d2180b2c2b`.
- Moderation release-gate strengthening PR #53 was merged as `ef2e85903f742c2d951a318a85e43582b932bf67`.
- NOVELIGHT CI, CodeQL, and the Beta P0 Database Gate passed on the relevant PR heads before merge.
- Vercel production deployment status was observed as successful after the relevant main merges.

## Production Supabase migrations

Production project ref: `fiepaguycecrredwrcwx`.

Observed production workflow sequence:

1. `status` showed the intended pending beta migrations only.
2. `dry-run` succeeded.
3. The beta P0 migrations were deployed in timestamp order.
4. Signup display-name migration `20260823192500` was later the only pending migration.
5. A second `dry-run` succeeded.
6. `20260823192500` was deployed successfully by the explicit `DEPLOY` workflow path.
7. The automated `production-beta-verification` commit status subsequently reported `success`.

The production verification is read-only and checks migration presence, profile display-name persistence, acquisition rows, lifecycle rows, recent beta activity, acquisition/lifecycle consistency, and pseudonymous hash invariants.

## Authentication end-to-end checks

Production origin: `https://novelrise.vercel.app`.

Supabase Auth redirect allowlist was observed to contain:

- `https://novelrise.vercel.app`
- `https://novelrise.vercel.app/reset-password.html`
- `https://novelrise.vercel.app/index.html`

Observed password recovery E2E:

- recovery email requested for a controlled account;
- recovery link opened the reset flow;
- a new password was accepted;
- login with the new password succeeded and reached the author home.

Observed signup E2E:

- a controlled account was registered with display name `登録テスト`;
- the confirmation email was received and the first confirmation-link use succeeded;
- the account could log in;
- after migration `20260823192500`, the author home displayed `登録テストさんの作者ホーム`;
- profile display name remained `登録テスト` after logout and a fresh login;
- the production `profiles` row was observed with the same display name.

A later second click of the already-consumed confirmation link returned `otp_expired`; this was not treated as a signup failure because the first confirmation had already completed and the account could authenticate normally.

## Acquisition / lifecycle / revisit evidence

For the controlled signup account, production rows were observed in:

- `user_acquisition`, with source `direct`;
- `user_lifecycle`, with registration/first-seen/last-seen timestamps.

Manual Table Editor inspection is no longer the normal verification path. The production workflow now runs the read-only observability check automatically and publishes `production-beta-verification`; that status was observed as `success`.

## Backup and restore hard-gate evidence

Production Supabase was upgraded to Pro on 2026-08-23.

Observed backup posture:

- automatic scheduled daily backups enabled;
- 7-day scheduled-backup retention shown in the production dashboard;
- a 2026-08-22 recovery point existed before the 2026-08-23 beta migration deployment window;
- PITR was evaluated but **not enabled**. The displayed PITR add-on price started at $100/month for 7 days, so the beta recovery posture remains Pro scheduled backups rather than PITR.

Non-production restore rehearsal on 2026-08-23:

- latest available production backup was restored to disposable project `novelight-restore-test-20260823` using Supabase Restore to new project;
- restored project reached Healthy;
- real `novels` rows were observed;
- real `episodes` rows were observed;
- real `profiles` rows were observed;
- Authentication users were observed in the restored project;
- the disposable restore project was deleted after validation;
- production `novelrise` remained Healthy;
- scheduled production backups remained enabled afterward.

No destructive production restore was performed.

## Moderation and support operations

Automated release gates verify:

- public novel-report route calls `submit_content_report` with novel ID and no episode ID;
- public episode-report route calls `submit_content_report` with both novel and episode IDs;
- both novel and episode reports persist through the database RPC in integration tests;
- raw `content_reports` rows are unreadable to anon/authenticated clients.

Operational automation:

- `.github/workflows/beta-ops-inbox.yml` checks production every 6 hours using a read-only query;
- only counts of new moderation reports and new support inquiries are read into GitHub;
- no report body, inquiry message, email, user ID, or visitor hash is copied to GitHub;
- waiting work creates/updates one `[OPS] NOVELIGHT beta inbox needs review` issue;
- a clear inbox closes that alert;
- `ops-inbox-watch` was observed as `success` after initial deployment;
- no open ops inbox alert existed immediately after the initial successful check.

Operator response rules are recorded in `docs/BETA-OPERATIONS-RUNBOOK.md`.

## Discovery and LIGHT ANALYTICS evidence

Automated database and source gates cover:

- Free works remain in the general discovery pool;
- Standard and Premium also remain in the general discovery pool;
- new Free work can receive `initial_exposure` allocation;
- Standard/Premium plan-extra selection is a separate surface;
- Standard additional exposure records `home_plan_extra` / `plan_extra`;
- Premium dedicated exposure records `home_premium_slot` / `premium_extra`;
- author analytics reads actual recorded plan-extra / premium-slot impression counts;
- recommended search records `search_recommended` impressions;
- new/PV/favorite neutral sorts use the neutral search-impression path;
- LIGHT ANALYTICS uses impression→detail, detail→episode 1, and episode 1→episode 2 denominators.

## Beta-start and Stripe evidence

Automated gates cover:

- X acquisition touch with `utm_source=x` / source `x`;
- raw visitor token is not persisted in the tested acquisition path;
- direct/X reader-journey event storage independently of internal discovery attribution;
- concurrency-safe Founding Author assignment #001–#100;
- Stripe webhook entitlement reconciliation against current Stripe state;
- delayed/out-of-order cancellation safety;
- repeated webhook delivery is entitlement-idempotent;
- `subscription_event_log` is private;
- webhook code writes audit history using `stripe_event_id` conflict handling with duplicate suppression;
- database event IDs are unique/idempotent.

## Remaining external / real-user gates

The following are not proven merely by repository CI and remain separate release decisions or controlled real-world checks:

1. **Qualified Japanese legal review / explicit residual-risk decision.** `docs/legal-beta-review.md` is an engineering/operations review, not legal advice. It currently recommends a qualified Japanese lawyer before public beta.
2. **Controlled end-to-end billing smoke.** Checkout, billing portal, cancellation, and resulting Stripe/Supabase entitlement transitions should be exercised in the intended test/controlled production mode before public beta GO.
3. **Full authenticated product smoke.** Real signed-in user flows for posting a novel, posting an episode, favorite, LIGHT SEED, SCOUT RECORD, and LIGHT ANALYTICS should be completed against the release environment or replaced by equivalent trustworthy automated E2E coverage before those checklist boxes are marked complete.

Do not mark public beta GO until the remaining hard gates in `docs/BETA-RELEASE-CHECKLIST.md` are satisfied or an explicit, documented release-risk decision changes the gate.
