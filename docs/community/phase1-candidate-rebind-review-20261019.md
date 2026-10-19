# Phase 1 reviewed content binding — no SHA circularity (2026-10-19)

Status: **DRAFT / REVIEW-ONLY. NOT APPROVED FOR MAIN OR HOSTED EXECUTION.**

PR #2222 candidate reviewed at `91114a536688411caa37a5640a14eca01c8e0335` against main `d70196d93e67058284f9d45b9f4d0d9d8b9c9b46`. Its 37 files and actual Git object blob SHA IDs are retained as the pinned *content diff* in `scripts/community-phase1-reviewed-candidate.mjs`. The current feature HEAD remains a separate dynamic, exact 40-character revision in the OWNER one-time comment and trusted GitHub compare. Future main-only safety-PR merges no longer require pinning the impossible future descendant HEAD in its own ancestor.

The full file manifest must match the complete, repository-sourced `compare/<CURRENT_MAIN>...<CURRENT_PR_HEAD>` file set: same 37 filenames, `added/modified` status, and exact Git blobs; zero extras, deletions, duplicates, missing evidence or altered files. The current PR head must contain current main (zero behind), compare base/head commit IDs must equal live refs, and the existing CI, CodeQL, one-use OWNER claim and closed-issue protections remain in force. The trusted workflow checks the manifest at OWNER admission and again in the protected job before it can attempt a Preview. A fresh current-main and PR-head check remains immediately before Preview creation.

**Cost gate unchanged:** Issue #188 stays closed and no Preview/branch or hosted test may start. A separate, verified exact-main/exact-HEAD, one-use `ステージング承認` remains necessary, as does authenticated GitHub Environment protection, provider-enforced spend limits and independently isolated Staging access. Never start any cost-bearing service just because this validation becomes green.

Historical/alternate hosted-write and interaction files that still pin an older candidate are deliberately *not re-enabled* by this security refinement. They must remain fail closed until a separate approved design addresses the same stale-head issue with isolated-resource identity, migration parity, and rollback evidence. Their old constants are not proof of present candidate eligibility; the Draft PR #2385's earlier attempted blind nine-file head rebind is withdrawn.

Before actual hosted acceptance or public release: resolve shared Staging migration drift (without blind repair), independently prove billing safeguards, obtain distinct authorization for expensive tests, and then a later separately scoped `本番承認` for Production. PR #2222 stays Draft; `timeline:false`, `board:false`, DB `public_enabled=false` remain required.

This is **one safe Preview candidate identity design**, not a grant of permission, not proof of production safety and not a claim that other dormant hosted code is ready.
