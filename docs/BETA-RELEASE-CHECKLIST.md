# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result, not an assumption.

## Git / CI

- [ ] PR is based on the latest approved `main` and the current `docs/NOVELIGHT-MASTER.md`.
- [ ] Required Node/format/lint/dependency gates pass.
- [ ] RLS/integration tests pass through the latest beta migrations.
- [ ] Desktop + mobile Playwright gates pass.
- [ ] No user-facing `NovelRise`/`NOVELRISE`/`novelrise` remains in root HTML.

## Supabase production

- [ ] `status` / `dry-run` shows only the migrations intended for this release.
- [ ] New beta migrations are deployed in timestamp order.
- [ ] Postchecks pass after deployment.
- [ ] Password recovery redirect URL for the production origin's `/reset-password.html` is allowed in Supabase Auth redirect configuration.
- [ ] Signup confirmation redirect for the production origin is allowed.
- [ ] A controlled password-reset end-to-end test succeeds: email -> reset page -> new password -> new login.

## Backup / restore — hard GO gate

- [ ] Production Supabase automatic backup/PITR capability was verified in the actual project dashboard.
- [ ] Recovery window and retention were recorded.
- [ ] A recovery point exists from before release deployment.
- [ ] `docs/BACKUP-RESTORE-RUNBOOK.md` was reviewed.
- [ ] Non-production restore rehearsal completed and recorded.

## Content / moderation

- [ ] New published work requires AI-use classification.
- [ ] Mature work requires one or more content warnings.
- [ ] Mature direct episode URL shows a warning gate.
- [ ] Prohibited sexually explicit/pornographic beta rule is visible before publishing.
- [ ] Novel report submission reaches `content_reports`.
- [ ] Episode report submission reaches `content_reports`.
- [ ] Raw report rows are not readable by anon/authenticated clients.
- [ ] Operator has a documented routine to inspect new reports/support inquiries during the controlled beta.

## Discovery / LIGHT ANALYTICS

- [ ] A new Free work can be selected by the initial-exposure priority when discovery traffic exists.
- [ ] General feed still includes Free / Standard / Premium.
- [ ] Standard plan-only exposure records `home_plan_extra`.
- [ ] Premium dedicated exposure remains separate from the general feed.
- [ ] Search recommended, new, PV and favorite sorts all record visible impressions.
- [ ] LIGHT ANALYTICS shows impression -> detail CTR.
- [ ] LIGHT ANALYTICS shows detail -> episode 1 rate.
- [ ] LIGHT ANALYTICS shows episode 1 -> episode 2 rate.
- [ ] Standard/Premium plan-added impressions can be read as actual recorded counts.

## Beta-start data

- [ ] X test URL with `utm_source=x` records an acquisition touch.
- [ ] Registration/login claims first-touch acquisition to the signed-in user.
- [ ] Daily revisit ledger records expected activity without raw visitor token storage.
- [ ] Direct/X detail and episode events persist independently of internal discovery attribution.
- [ ] First qualifying authors receive concurrency-safe Founding Author #001–#100 records.
- [ ] Verified Stripe webhook writes idempotent subscription event history.

## Legal / brand

- [ ] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact are reachable from public navigation/footer surfaces.
- [ ] Content guidelines describe the live report route in present tense.
- [ ] Privacy policy describes UTM/acquisition, pseudonymous visit/activity and analytics processing actually used in beta.
- [ ] Final Japanese legal review status has been recorded; any accepted residual risk is explicit.

## Final smoke

- [ ] Signup
- [ ] Login
- [ ] Password recovery
- [ ] Search
- [ ] Novel detail
- [ ] Episode reading
- [ ] Novel posting
- [ ] Episode posting
- [ ] Favorite
- [ ] LIGHT SEED
- [ ] SCOUT RECORD
- [ ] LIGHT ANALYTICS
- [ ] Pricing/checkout test mode or approved controlled production check
- [ ] Billing portal/cancel flow

Only mark public beta GO after all hard gates are satisfied.
