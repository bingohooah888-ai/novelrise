# NOVELIGHT ADMIN

NOVELIGHT ADMIN is the operator-only beta dashboard served from `admin.html`.

## Access model

The admin page is intentionally not linked from ordinary NOVELIGHT navigation. This is only a discoverability choice, not a security boundary.

Real authorization is enforced by `GET /api/admin-dashboard`:

1. the browser must present a current Supabase access token in the `Authorization: Bearer ...` header;
2. the server verifies the token with Supabase;
3. the authenticated account must match a server-side admin allowlist;
4. only then does the server use the existing server-only `SUPABASE_SECRET_KEY` to read aggregate/operator data.

A user who knows the `admin.html` URL but is not allowlisted receives `403 Forbidden` and no dashboard data.

The API is GET-only, sends `Cache-Control: private, no-store`, rejects cross-site requests, and does not expose the Supabase secret key to browser code.

## Admin allowlist

Configure at least one of the following **server-side Vercel environment variables**:

- `NOVELIGHT_ADMIN_USER_IDS` — comma-separated Supabase Auth user UUIDs. This is the preferred immutable identity check.
- `NOVELIGHT_ADMIN_EMAILS` — comma-separated authenticated account emails. This is a fallback when the UUID is not convenient to obtain yet.

Do not place either value in `admin.html`, another browser file, or a public GitHub file. Configure Production and Preview separately when Preview admin access is needed.

If neither allowlist is configured, or if an allowlist value is malformed, the API fails closed with `503` and does not return admin data.

## Data minimization

The overview returns aggregate beta data needed for operational decisions:

- total and recent registrations;
- author and reader activity counts;
- published works and zero-PV works;
- work/episode PV and favorites totals;
- Free / Standard / Premium counts;
- 30-day author/reader return-based retention where a full cohort exists;
- reader journey funnel counts;
- acquisition-source breakdown;
- pending report/inquiry counts;
- top works by PV.

The user search returns only the minimum operator fields needed for support/diagnosis: display name, user ID, plan/billing state, activity timestamps, work counts, work PV/favorites, acquisition metadata, and Founding Author number where applicable.

The admin overview deliberately does **not** return:

- user email addresses;
- contact inquiry email/message bodies;
- content report detail bodies;
- Stripe customer/subscription IDs;
- Supabase secret keys or credentials;
- raw visitor tokens.

When raw support/report content is needed, continue to use the existing controlled Production operations procedure in `docs/BETA-OPERATIONS-RUNBOOK.md`.

## Retention semantics

The v1 30-day author/reader metrics are return-based. A user is eligible only after 30 days have elapsed since registration, and is counted retained when `user_lifecycle.last_seen_at` reaches at least 30 days after registration.

Author cohorts are users who have created at least one work. Reader cohorts are registered users with at least one recorded reader-journey event. Until enough beta time has elapsed, the UI shows `データ蓄積中` instead of presenting a fabricated percentage.

## Operational boundary

NOVELIGHT ADMIN v1 is read-only. It does not provide buttons for banning users, changing plans, resolving reports, deleting content, editing Production rows, or mutating Stripe/Supabase state.

Any future write action must be designed as a separate high-risk capability with explicit authorization, audit logging, confirmation/rollback rules, and the existing Production approval gates.
