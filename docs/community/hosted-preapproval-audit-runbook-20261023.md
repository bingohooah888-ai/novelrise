# Community Hosted Phase 1 — read-only, preapproval diagnostics

**Scope:** Draft Community PR #2222, trusted main, cost gate [Issue #188](https://github.com/bingohooah888-ai/novelrise/issues/188). This is **only a manual GET-only inspection**, not a new hosted-test executor.

## Before issuing any paid Staging approval

1. Merge the review-only [preapproval audit workflow](../../.github/workflows/community-hosted-preapproval-audit.yml) to trusted main under a **separate main-merge approval**. This adds no automatic runs. The workflow is invoked only by the repository OWNER, manually, on main.
2. Configure repository secret `COMMUNITY_PROTECTION_READ_TOKEN` using a **separate least-privilege GitHub fine-grained token** able to GET the repo's environment protection, deployment branch policies, Actions workflow, Actions variable and runs; do not paste the token in chat or logs. The default `GITHUB_TOKEN` may not expose repository administration/environment facts. This token must not grant issue changes or repository/content writes.
3. The workflow inspects live (not candidate-provided) GitHub facts for: current main; exact Draft PR #2222 compare and full reviewed Git blob manifest; the Issue #188 closed state; protected `community-hosted-isolated` with a different human reviewer, self-review OFF and admin bypass OFF; main-only `community-hosted-cleanup` without human-blocking rules; enabled `NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED` variable; and a recent, successful independent scheduled cleanup job.
4. The output is **always `READ_ONLY_APPROVAL_PREPARATION_BLOCKED`**, including if all GitHub checks are true. Provider-enforced billing safeguards, authenticated independent spending grant, isolated Supabase disposable branch lifecycle, Vercel Preview/Stripe isolation and cleanup capabilities are **outside** this workflow. Do not set cost approved/authorize writes from its output.
5. Any missing/403/404 GitHub API permissions are reported as missing evidence, not success. Until a live cleanup environment with appropriate credentials and independent, tested cleanup has been safely configured, watchdog should remain disabled.
6. When those external blockers are independently resolved, separately scope a one-time OWNER approval with current main SHA, exact PR #2222 head, a stated timebox and billing acknowledgement. **Never reuse** old Staging approval. Existing Issue #188 is closed and must not be reopened merely to run this diagnostic.

## Explicitly out of scope

No Vercel Preview deployment, no Supabase branch creation/deletion, no browser sign-in, no Stripe requests, no production/Shared Staging schema write, no GitHub issue/approval comment, no `CLAIM`, and no automatic billable workflow dispatch. A manual GitHub Actions run may still consume ordinary GitHub Actions minutes; it is **not** a guarantee of zero platform charges.

The feature remains Draft/private, DB `public_enabled=false`, and current main retains a read-only hosted executor. Main merge, Staging spending, Production migration, feature merge and public activation each require their own appropriate approval.
