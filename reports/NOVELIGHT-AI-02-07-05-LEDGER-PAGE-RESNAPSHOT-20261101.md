# NOVELIGHT AI 02-07-05 — GitHub OWNER Ledger Double-Page Snapshot
Base main SHA: `1570677765f7204ddd4278ea02f20026718fab02`. 2026-11-01 JST.

## Root cause
The read-only Issue #294 adapter originally fetched comment pages just once and then rechecked the Issue comment count. With unchanged count, an in-flight change to a comment ID, author identity, body, or timestamp could evade the adapter's one-pass consistency check.

## Limited offline fix
- Repeat all comment page GET requests and compare the complete ordered tuple (ID, exact body, creation/update timestamps, user ID/login/type, author_association). Deny when a page changes even if the issue's comment count stays constant.
- Recheck the Issue's number, title, state and count **after** both complete scans.
- Retain hardcoded GitHub API allowlist, GET-only semantics, no redirects, secret-free errors, and the independent OWNER approval/CLAIMED/CONSUMED structural verifier.
- Synthetic tests cover stable four-GET flow, same-count changed body/author/ID, issue count change and incomplete pages.

## Explicit limits and approval boundary
Repeated GETs are not atomic. Even two agreeing scans cannot guarantee that the Issue was not modified immediately afterward, nor establish live runner status, independent heartbeat, Staging cleanup, actual AI usage or zero-residue census. The component is dormant and no GitHub Actions workflow invokes it.
No new Preview, Staging mutation, real JWT, paid AI call, AI activation, external cleanup or manual Production change is performed. Exact-HEAD separate OWNER approval is needed for PR squash merge; ordinary Vercel Production automatic build may result only after that approval.
