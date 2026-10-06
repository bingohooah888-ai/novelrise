# NOVELIGHT Preview / Staging cost-control automation

This document records the stable operating model for Vercel Preview and Supabase Staging after the 2026-10-06 cost-control change.

## Goal

Preview / Staging must remain available when it is genuinely needed, but it must never run merely because a normal implementation branch was pushed or a pull request was updated.

The default state is **Default-Deny / locked / no external Preview-Staging execution**.

## Default Vercel behavior

`vercel.json` permits Git-triggered deployment only for `main`.

All non-`main` branches are default-deny. In particular, ordinary `fix/**`, `feat/**`, `codex/**`, `chore/**`, `test/**`, `docs/**`, dependency branches, and dedicated Staging refs must not create a Vercel Preview merely because they were pushed.

Production behavior for `main` is unchanged.

## Human approval boundary

A cost-incurring Preview / Staging action requires an explicit user **「ステージング承認」** (or an equally explicit statement authorizing the same Preview / Staging execution).

The following do not authorize it:

- 「はい」
- 「続けて」
- generic 「承認」
- 「本番承認」 by itself
- approval remembered from another chat
- an earlier Staging approval for a different SHA, scope, or run

One Staging approval is bound to:

1. exact current `main` SHA;
2. one declared scope;
3. one execution.

After success, failure, or cancellation, the default lock applies again.

## Machine-readable approval bridge

The user is not asked to type JSON or GitHub comments manually.

After the user gives `ステージング承認`, ChatGPT / NLO resolves current `main`, chooses the required scope, and writes one OWNER-authored approval comment to the fixed control issue. Preview/browser smoke scopes use Issue #188; Supabase Staging mutation scopes use Issue #294.

Canonical comments are:

```text
# Issue #188
NOVELIGHT_STAGING_APPROVE {"scope":"full-smoke","mainSha":"<40-char-sha>","confirmation":"STAGING APPROVED"}
NOVELIGHT_STAGING_APPROVE {"scope":"thumbnail-smoke","mainSha":"<40-char-sha>","confirmation":"STAGING APPROVED"}
NOVELIGHT_STAGING_APPROVE {"scope":"live-proof","mainSha":"<40-char-sha>","previewUrl":"https://<exact-preview>.vercel.app","confirmation":"STAGING APPROVED"}

# Issue #294
NOVELIGHT_STAGING_APPROVE {"scope":"migration-sync","mainSha":"<40-char-sha>","migration":"<14-digit-version>","confirmation":"STAGING APPROVED"}
NOVELIGHT_STAGING_APPROVE {"scope":"base-books-recovery","mainSha":"<40-char-sha>","packKey":"NOVELIGHT_base_books_32_final","geometryMigration":"20260920204000","confirmation":"STAGING APPROVED"}
```

Each workflow re-resolves current `main` and fails closed if it no longer matches the approved SHA.

## Workflow entry points

### Full Staging Smoke

`.github/workflows/staging-smoke.yml` accepts only the Issue #188 OWNER approval contract for `scope=full-smoke`.

It does not start from:

- pull request events;
- pushes;
- Vercel `deployment_status`;
- Issue reopen;
- unconditional `workflow_dispatch`.

### Thumbnail Staging Smoke / explicit Preview creation

`.github/workflows/staging-thumbnail-smoke.yml` accepts only `scope=thumbnail-smoke`.

After approval it:

1. verifies exact current `main`;
2. pins the dedicated `staging-thumbnail-smoke` ref to that approved SHA;
3. creates exactly one non-Production Vercel deployment through the bounded Vercel API helper;
4. verifies isolated Supabase Staging configuration;
5. runs the focused thumbnail flow.

Updating the dedicated ref alone does not create a Git-triggered Preview because non-`main` Git deployments are disabled.

### Staging Live Proof

`.github/workflows/staging-live-proof.yml` accepts only `scope=live-proof` with an exact Preview origin and SHA.

It no longer reacts automatically to every Vercel deployment.

## Supabase Staging

Supabase Staging remains a dedicated non-Production target because some high-risk verification still needs realistic Auth / RLS / browser behavior.

Keeping the Staging project available does **not** authorize arbitrary test traffic. Write-capable smoke, migration sync, recovery, and other paid/active Staging use remain behind their fixed control contracts.

`.github/workflows/supabase-staging-sync.yml` is reusable-only and cannot be started with a direct `workflow_dispatch`. The Issue #294 request bridge is the only ordinary entry point for migration mutation. The base-book recovery workflow likewise has no direct manual dispatch bypass.

Read-only inspection of Staging configuration, branch state, billing, usage, and logs does not require Staging approval.

## Canonical Preview variables

Preview deployments that are explicitly approved use:

- `NOVELIGHT_STAGING_SUPABASE_URL`
- `NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY`

They must resolve to the isolated Supabase Staging target and must never point to Production.

## Cross-chat persistence

This policy is repository state, not chat memory.

Every new chat / agent must use latest-main `AGENTS.md`, `docs/NOVELIGHT-MASTER.md`, this document, and the current workflow contracts. A missing conversation history is never a reason to restore automatic Preview / Staging execution.
