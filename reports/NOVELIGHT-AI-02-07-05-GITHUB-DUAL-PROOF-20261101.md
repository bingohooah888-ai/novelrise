# AI 02-07-05 — GitHub-only two-reader evidence comparison (offline)
Base main SHA: `0ba20bc5ec3467d79ac9c562fe8383153c031651`.

## Scope and intent
- Adds a standalone, dormant read-only coordinator `.github/staging-ai-02-07-05/github-dual-proof-readonly.mjs`. Existing **issues:read** and **actions:read** reader modules are reused without changing their behavior.
- A future separately approved protected controller can supply least-privilege scoped tokens and read GitHub Issue #294 and one GitHub Actions OWNER workflow run, each with its own GET-only snapshot checks.
- Correlates the exact OWNER approval comment, run ID, main SHA, approved Preview, GitHub workflow identity, job exit, cross-reader observation window and no-retry guards.
- Outputs `GITHUB_UNCLAIMED_NO_EXECUTION`, `GITHUB_CLAIMED_RUN_NOT_TERMINAL`, `GITHUB_CONSUMED_RUN_STILL_ACTIVE_CONFLICT`, `GITHUB_TERMINAL_CLAIMED_NEEDS_INDEPENDENT_EVIDENCE` or `GITHUB_TERMINAL_CONSUMED_NEEDS_ZERO_CENSUS`. Every status is non-executable and leaves `proposedActions: []`.
- Synthetic fixture tests cover exact GET-only requests, two-token separation, terminal/active/unclaimed/consumed evidence, mismatched SHA, changed job snapshot and sanitized errors.

## Explicit NO-GO boundaries
- This module **does not trigger GitHub Actions or use any actual GitHub credentials**. The tests use injected mock fetch only. No integration with the site's running application or protected GitHub Actions workflow.
- The existing OWNER Staging paid trial workflow remains **OFFLINE PREFLIGHT ONLY**. Its run completion is not evidence of provider spend or live Staging AI processing.
- GitHub-only records cannot authenticate an independent heartbeat, actual synthetic actor/project execution, real JWT, final cleanup or Staging zero-residue census. This module explicitly marks these as not verified.
- No Preview, Staging database write, AI call, paid provider, secret read, AI enablement, watchdog schedule, cleanup or manual Production mutation. A separate exact-HEAD OWNER approval is needed to merge this PR; the ordinary automatic Production build may occur after such approval.
