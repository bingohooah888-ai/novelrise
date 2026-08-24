# NOVELIGHT controlled-beta operations runbook

Last updated: 2026-08-24

## Purpose

This runbook defines the minimum operator routine for the controlled public beta. The goal is to avoid relying on ad-hoc Supabase dashboard checks when moderation or support work is waiting.

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
