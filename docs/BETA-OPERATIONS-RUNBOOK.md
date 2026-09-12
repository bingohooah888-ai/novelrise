# NOVELIGHT controlled-beta operations runbook

Last updated: 2026-09-12

## Purpose

This runbook defines the minimum operator routine for the controlled public beta. The goal is to avoid relying on ad-hoc Supabase dashboard checks when moderation or support work is waiting.

## Public beta launch-day cutover — 2026-09-30 JST

The public beta launch is a campaign-state cutover, not a migration or billing operation. The intended launch transition is `PRE_REGISTRATION` -> `BETA_OPEN` through the authenticated ADMIN beta-author screen.

### Preconditions

1. Confirm the release date is still **2026-09-30** in `docs/NOVELIGHT-MASTER.md` and that the current release checklist/evidence does not contain a new technical blocker.
2. Confirm the intended `main` commit is deployed to Vercel Production and its required repository/Production readiness checks are green or remain specifically still-valid under the evidence-freshness rules.
3. Do **not** rerun an already-applied Production migration, Production Auth Smoke, Stripe operation, Secret change, or official-thumbnail registration merely to refresh documentary SHA alignment.
4. Open `admin-beta-authors.html` through the normal ADMIN-authenticated path. Do not update the campaign by direct Production SQL.
5. Confirm the current campaign state is `PRE_REGISTRATION`. If it is already `BETA_OPEN`, `CLOSED`, unknown, or cannot be loaded, stop the cutover and investigate before changing anything.
6. Confirm the release-label field is exactly `2026年9月30日`. If the stored value is stale, correct it in the same ADMIN save used for the launch transition.

### Cutover

1. Change the campaign state from `PRE_REGISTRATION` to `BETA_OPEN`.
2. Leave the release label as `2026年9月30日`.
3. Click the campaign save button once.
4. Read the state-change confirmation dialog carefully and approve it only if the target shown is `BETA_OPEN`.
5. Do not select `CLOSED` for the public beta launch. `CLOSED` is not the launch state.
6. Wait for the ADMIN success result before taking any second action. Do not double-submit the state change.

The campaign save updates the campaign state and release label together through the authenticated ADMIN API. The preregistration database function independently enforces the campaign state and accepts a registration only while the state is `PRE_REGISTRATION`; its execution privilege is server-side only.

### Immediate post-cutover verification

Perform read-only/public verification before announcing the launch:

1. Reload `admin-beta-authors.html` and confirm the stored state is `BETA_OPEN` and the release label is `2026年9月30日`.
2. Open `beta-authors.html` in a clean public session and confirm it presents the beta-open state rather than the preregistration form.
3. Follow the public beta-open CTA and confirm it routes to `signup.html`.
4. Open `signup.html` in a clean public session and confirm the ordinary signup form is exposed for the beta-open state.
5. Confirm login remains available.
6. Do not create a dummy preregistration merely to prove the stop condition; the campaign-state gate is enforced server-side and should be verified through the state/UI contract unless a separate approved diagnostic is required.
7. Record the exact deployed `main` SHA, JST cutover time, state before/after, and verification result in the release evidence trail. Do not include preregistration PII in GitHub or chat logs.

### Rollback / incident handling

If a verification step fails **before the public launch announcement**, use the same authenticated ADMIN path to return the campaign to `PRE_REGISTRATION`, confirm the rollback dialog, then verify that the preregistration page and signup gate have returned to the pre-launch state. Record the failure and do not announce the launch until the cause is understood.

After the public launch announcement, do not oscillate campaign states in response to ordinary defects. Treat the problem as a launch incident, preserve the observed evidence, and make an explicit owner decision before reopening preregistration or otherwise changing the public campaign state.

## Automated inbox watch

`.github/workflows/beta-ops-inbox.yml` checks the production database every 6 hours using the Supabase Management API read-only query endpoint.

It reads **counts only** for:

- `public.content_reports` where `status = 'new'`
- `public.contact_inquiries` where `status = 'new'`

It never copies report bodies, inquiry messages, email addresses, user IDs, visitor hashes, or other raw production rows into GitHub.

If either count is greater than zero, the workflow creates one open GitHub issue titled:

`[OPS] NOVELIGHT beta inbox needs review`

While the issue remains open, its body is updated only when the report/inquiry counts actually change. An unchanged count does not generate another six-hour comment or edit. This keeps the alert actionable without creating repetitive operational noise.

When both counts return to zero, the workflow records one clear-resolution comment and closes the alert issue automatically.

The workflow also publishes an `ops-inbox-watch` commit status so the health of the automated watch can be checked without opening Supabase.

## Operator routine when an alert appears

1. Open the production Supabase project and confirm that the project/ref is the real NOVELIGHT production project.
2. Review `content_reports` rows with `status = 'new'`.
3. Review `contact_inquiries` rows with `status = 'new'`.
4. Do not copy raw report/inquiry contents into public GitHub issues, chat logs, or other uncontrolled systems.
5. Move a report/inquiry to `reviewing` when work begins, then to `resolved` or `dismissed` where the schema permits after the decision is complete.
6. Prioritize safety, copyright/legal, payment, account-access, and legal-information requests over ordinary feedback.
7. For a serious safety/legal/payment incident, preserve relevant evidence and stop the affected write path if continued writes could worsen the problem.

## Moderation principles

- AI detection alone is not a sufficient basis for automatic deletion or banning.
- Reports are signals for operator review; they are not proof of a violation.
- Content decisions must remain aligned with `docs/NOVELIGHT-MASTER.md`, `content-guidelines.html`, the beta adult-content rule, applicable law, Stripe rules, and hosting-provider requirements.
- Raw `content_reports` rows remain private from anonymous/authenticated clients; public users submit only through the validated reporting RPC.

## Support / legal requests

- The controlled-beta minimum is to resolve the automated alert at least daily; the watcher itself runs every 6 hours.
- Legal-information requests connected to the 特定商取引法 disclosure should be handled promptly once discovered.
- Never request or store raw card details. Stripe remains the payment processor for card information.

## Failure of the automation

If the `ops-inbox-watch` commit status is failing or the scheduled workflow is disabled:

1. Treat the automation itself as an operational incident.
2. Until repaired, manually check `content_reports` and `contact_inquiries` at least daily.
3. Repair the watcher before expanding the beta cohort.

The fallback manual check exists only for automation failure; routine beta operations should use the automated watcher.
