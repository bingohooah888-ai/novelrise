# NOVELIGHT controlled-beta operations runbook

Last updated: 2026-09-20

## Purpose

This runbook defines the minimum operator routine for the controlled public beta. The goal is to avoid relying on ad-hoc Supabase dashboard checks when moderation or support work is waiting.

## Founding-author preopen cutover — 2026-09-28 JST

The preopen is a campaign-state cutover, not a migration or billing operation. Before changing state, confirm that the beta-author preopen migration is already applied in Production and that the current release evidence contains no new blocker.

1. Open `admin-beta-authors.html` through the normal ADMIN-authenticated path.
2. Confirm the current campaign state is exactly `PRE_REGISTRATION` and the release label is `2026年9月30日`.
3. Change only the campaign state to `AUTHOR_PREOPEN`, read the confirmation dialog, and save once.
4. Reload ADMIN and confirm the stored state is `AUTHOR_PREOPEN`.
5. In a clean public session, confirm `beta-authors.html` shows the preopen state and routes to `signup.html`.
6. Confirm `signup.html` shows the preopen notice and signup form.
7. Use an approved non-PII diagnostic path to verify that a preregistered author email can enter the Auth flow while a non-preregistered email remains rejected. Do not copy raw preregistration addresses into GitHub or chat evidence.
8. If verification fails before the preopen announcement, return the state to `PRE_REGISTRATION`, record the failure, and stop. Do not open general signup as a workaround.

While `AUTHOR_PREOPEN` is active, the Supabase Before User Created hook allows Auth creation only when `event.user.email` matches a non-cancelled preregistration row. The public preregistration intake is closed. Existing accounts can still log in.

## Content inventory / first-reader-path gate — 2026-09-29 JST

This is a **read-only launch gate** between founding-author preopen and public beta. It must not change the campaign state, Production rows, Stripe objects, Secrets, or billing state. Its purpose is to prove that the real public catalog is no longer empty and that a first anonymous reader can actually reach readable story text before `BETA_OPEN`.

### Preconditions

1. Resolve fresh `main`, re-read the current release evidence under `docs/EVIDENCE-FRESHNESS-GATE.md`, and confirm that no new non-deferred blocker has appeared.
2. Confirm the Production campaign state is exactly `AUTHOR_PREOPEN` and the release label remains `2026年9月30日`. If the state is still `PRE_REGISTRATION`, already `BETA_OPEN`, `CLOSED`, or unknown, stop and investigate instead of forcing this gate.
3. Do not rerun a Production migration, Production Auth Smoke, Stripe operation, Secret change, official-thumbnail registration, or campaign cutover merely to execute this gate.

### Automated read-only gate

Run the GitHub Actions workflow **`NOVELIGHT Beta Inventory First Reader Gate`** from the intended launch `main` SHA.

The workflow performs only these checks:

- queries Production through the Supabase Management API **read-only** database-query endpoint and emits aggregate counts only;
- requires at least one published work, one published author, and one published episode;
- requires zero published works that have no published episode;
- runs the existing Production reader smoke with `NOVELIGHT_REQUIRE_PUBLISHED_CATALOG=1`;
- suppresses the reader-smoke measurement-write RPCs, so the browser proof does not intentionally add PV, impression, acquisition, or reader-journey telemetry;
- proves the anonymous path `search -> work detail -> published episode body` against the real Production site.

The workflow must fail if the catalog is empty, if a published work has no published episode, or if the anonymous reader path cannot reach non-empty episode content.

A workflow PASS is the technical minimum for this gate. It does **not** invent a business threshold for how many works or genres are “enough.” Record the aggregate inventory counts from the run. If no separate MASTER-approved minimum inventory target exists, the owner must explicitly decide whether the observed catalog breadth is acceptable for the public-beta launch rather than silently treating `>= 1` as a product-success threshold.

### Gate result

Record the following non-PII evidence in the rolling release trail:

- exact `main` / workflow head SHA;
- workflow run ID and conclusion;
- published-work count;
- published-author count;
- published-episode count;
- published-work-without-published-episode count;
- first-reader-path result;
- owner inventory-breadth decision when no formal minimum target exists.

Do not record work titles, author identities, preregistration email addresses, Auth IDs, or other PII merely to prove inventory.

If either the automated technical gate or the owner inventory-breadth decision is not PASS/accepted, leave the campaign in `AUTHOR_PREOPEN` and do **not** perform the 2026-09-30 `BETA_OPEN` cutover. Fix the underlying content/reader-path issue, gather fresh evidence, and rerun only this read-only gate.

## Public beta launch-day cutover — 2026-09-30 JST

The public beta launch is the second campaign-state cutover. The intended launch transition is `AUTHOR_PREOPEN` -> `BETA_OPEN` through the authenticated ADMIN beta-author screen.

### Preconditions

1. Confirm the release date is still **2026-09-30** in `docs/NOVELIGHT-MASTER.md` and that the current release checklist/evidence does not contain a new technical blocker.
2. Confirm the intended `main` commit is deployed to Vercel Production and its required repository/Production readiness checks are green or remain specifically still-valid under the evidence-freshness rules.
3. Do **not** rerun an already-applied Production migration, Production Auth Smoke, Stripe operation, Secret change, or official-thumbnail registration merely to refresh documentary SHA alignment.
4. Open `admin-beta-authors.html` through the normal ADMIN-authenticated path. Do not update the campaign by direct Production SQL.
5. Confirm the current campaign state is `AUTHOR_PREOPEN`. If it is `PRE_REGISTRATION`, already `BETA_OPEN`, `CLOSED`, unknown, or cannot be loaded, stop the cutover and investigate before changing anything.
6. Confirm the release-label field is exactly `2026年9月30日`. If the stored value is stale, correct it in the same ADMIN save used for the launch transition.

### Cutover

1. Change the campaign state from `AUTHOR_PREOPEN` to `BETA_OPEN`.
2. Leave the release label as `2026年9月30日`.
3. Click the campaign save button once.
4. Read the state-change confirmation dialog carefully and approve it only if the target shown is `BETA_OPEN`.
5. Do not select `CLOSED` for the public beta launch. `CLOSED` is not the launch state.
6. Wait for the ADMIN success result before taking any second action. Do not double-submit the state change.

The campaign save updates the campaign state and release label together through the authenticated ADMIN API. The preregistration database function accepts new preregistrations only while the state is `PRE_REGISTRATION`. During `AUTHOR_PREOPEN`, the Auth hook admits only non-cancelled preregistered emails; ordinary Auth signup opens at `BETA_OPEN`. These write boundaries remain server-side.

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

If a verification step fails **before the public launch announcement**, use the same authenticated ADMIN path to return the campaign to `AUTHOR_PREOPEN`, confirm the rollback dialog, then verify that general signup is closed while preregistered-author access remains available. Record the failure and do not announce the launch until the cause is understood. Return all the way to `PRE_REGISTRATION` only if the preopen itself must also be suspended.

After the public launch announcement, do not oscillate campaign states in response to ordinary defects. Treat the problem as a launch incident, preserve the observed evidence, and make an explicit owner decision before reopening preregistration or otherwise changing the public campaign state.

## First-author onboarding and preregistration milestones

The preregistration ADMIN is a lead/status record and operational dashboard. It is not an email or DM delivery system, and it does not automatically prove that a preregistered author has created an Auth account or published a work.

Use this order for the initial beta cohort:

1. While the campaign is `PRE_REGISTRATION`, keep the preregistration row as the lead record. If outreach is sent by X DM, email, or another external channel, complete that outreach outside NOVELIGHT first.
2. Record the ADMIN `invited` / 「案内送付記録済み」milestone only **after the external outreach was actually completed**. Do not use the milestone as a request to send outreach and do not mark it speculatively.
3. After the campaign becomes `AUTHOR_PREOPEN`, a preregistered author may create the NOVELIGHT account through `signup.html` using the same email address used for preregistration and complete the confirmation email flow. General signup remains blocked until `BETA_OPEN`.
4. Beta Standard is self-service. If the author wants Standard during the beta, they use the pricing page action `Standardを無料で利用`. The beta Standard path requires no card registration. Do not manually change Stripe state, entitlement rows, or Production billing data for an ordinary beta Standard activation.
5. Update `registered_at` / 「本登録済み」only after there is reliable evidence that the preregistered author has actually completed the NOVELIGHT account registration. Outreach completion or preregistration alone is not sufficient.
6. Update `first_novel_at` / 「初投稿済み」only after there is reliable evidence that the author has actually completed the first qualifying work publication. Do not infer publication from signup, profile creation, or an invitation status.
7. The preopen Auth gate matches the submitted Auth email to preregistration eligibility only; it does **not** automatically advance ADMIN conversion milestones such as `registered_at` or `first_novel_at`. Continue treating those milestones as operator-confirmed unless a later MASTER-approved automation changes that contract.
8. Founding Authors eligibility is determined automatically from the qualifying real-author publication flow. Do not reserve, reorder, or manually assign Founding Authors slots based on preregistration order or outreach order.
9. Never copy preregistration email addresses, comments, Auth identifiers, or other PII into GitHub issues, release evidence, or chat logs merely to prove conversion. Record counts/status and non-PII evidence only.
10. Account-access, payment, safety, or legal problems discovered during onboarding follow the normal support/incident path below. Do not bypass that path with direct Production SQL or ad-hoc Stripe/Secret changes.

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
