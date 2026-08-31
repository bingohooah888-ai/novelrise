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

## Automated Production allowlist synchronization

Production synchronization of `NOVELIGHT_ADMIN_USER_IDS` is handled by `.github/workflows/vercel-admin-allowlist.yml` after the automation change is merged. The workflow deliberately separates configuration bootstrap, request creation, OWNER approval, and the Production mutation.

### One-time secret bootstrap

Store the following only in GitHub Actions secrets. Never paste these values into a public issue, pull request, source file, or chat transcript:

- `VERCEL_API_TOKEN` — a Vercel Access Token with the minimum project/team access needed to read and update the `novelrise` project environment and create a Production deployment.
- `VERCEL_TEAM_ID` — the Vercel team identifier used to scope API calls to the team that owns `novelrise`.
- `NOVELIGHT_PRODUCTION_ADMIN_USER_IDS` — the canonical source allowlist, containing one or more comma-separated Supabase Auth UUIDs.

The GitHub secret is the control-plane source. The workflow writes its value to Vercel as the sensitive Production variable `NOVELIGHT_ADMIN_USER_IDS`. The raw UUID list and Vercel token are not placed in approval issues or workflow summaries.

### Request and approval flow

A request can be started by an OWNER comment on the Production control issue (`#165`):

`NOVELIGHT_VERCEL_ADMIN_ALLOWLIST_REQUEST`

The request phase is read-only. It verifies that the three bootstrap secrets exist, canonicalizes the UUID list, calculates a SHA-256 fingerprint, inspects the Vercel Production environment, checks the live deployment revision, and compares prior successful freshness proof. If the same managed sensitive value is already proven active on current `main`, the request is a no-op and no Production approval is created.

When a refresh is required, the workflow creates a dedicated approval issue containing only the exact `main` SHA, one-time request ID, expiry, challenge, fingerprint, and whether the Vercel environment value itself needs mutation. It never records the raw UUID list.

Only the repository OWNER can approve, using the exact approval comment generated in that dedicated issue. The approval expires, is one-time use, is bound to the exact `main` SHA and fingerprint, and is claimed before any Production mutation. If `main`, the source GitHub secret, or the observed Vercel state changes after request creation, the workflow fails closed and a new request is required.

### Production synchronization and proof

For an approved request the workflow:

1. re-validates the exact approval and current `main`;
2. re-computes the source fingerprint from the GitHub secret;
3. refuses to overwrite an existing non-sensitive Production variable;
4. creates or updates only the sensitive Production `NOVELIGHT_ADMIN_USER_IDS` variable when the value actually needs synchronization;
5. confirms the managed fingerprint and Vercel `updatedAt` metadata;
6. creates a new Vercel Production deployment pinned to the approved GitHub SHA so the new environment value is actually loaded;
7. waits for the exact deployment to reach `READY`;
8. verifies `/api/deployment-revision` converges to the approved SHA;
9. verifies `/api/admin-dashboard` still returns `401` without authentication;
10. records a non-secret consumed proof on the dedicated approval issue and control issue #165.

A failed deployment after an environment update does not silently count as complete. Because no successful consumed proof is written, a later request can approve only the still-open redeploy portion without rewriting an environment value already classified as current.

### Fail-closed boundaries

The automation does not delete or convert an existing non-sensitive `NOVELIGHT_ADMIN_USER_IDS`; that unexpected state is classified as unknown and requires investigation. It does not mutate Preview or Development values, does not change Supabase data, does not change Stripe state, and does not make the ADMIN dashboard writable.

Vercel sensitive values cannot be read back as plaintext. Freshness therefore uses the managed SHA-256 fingerprint, Vercel environment metadata, the successful control ledger, and the live Production revision together instead of pretending to decrypt or compare the stored secret directly.
