# Community staging candidate — OWNER approval contract (uninstalled)

**Preparation only. This is NOT a GitHub Actions workflow.**

This security contract is **offline and side-effect-free**. It does not
authenticate GitHub API results or users; a future trusted, default-branch
workflow must obtain live GitHub data with authenticated API calls.

Source: `scripts/community-staging-candidate-contract.mjs`

## Strict approval shape (future only)

- Fixed Issue **#294**, current approved title and OWNER identity
- A new prefix `NOVELIGHT_STAGING_COMMUNITY_CANDIDATE_APPROVE `
- Exact JSON keys: scope, mainSha, candidateSha, migration, confirmation
- Exact scope `community-phase1-isolated` and migration `20261014052000`
- Both SHAs exact; re-read current main and PR #2222 head immediately
  before each stage; require PR still open/Draft and merged=false
- A genuine live GitHub compare response must show candidate ahead of
  exactly the current main (same base, no divergence).
- A fully paginated Issue #294 OWNER ledger must show no prior claim or
  consumption of this request comment; stop if ledger pagination incomplete
  or any marker cannot be parsed.
- Pure code returns `CONTRACT_MATCH_ONLY` and
  `stagingMutationPermitted=false` **even for a matching mocked request**.
  No request in this document grants anything.

## Execution-specific safeguards NOT installed

A real executor would need independent OWNER authorization from GitHub
events, a trusted reviewed workflow already installed on default branch,
and an immutable **reviewed artifact manifest** (candidate blob hashes).
Only the exact reviewed SQL artifacts can be fetched from the candidate
commit. Never run scripts, `npm install`, third-party actions, or arbitrary
workflow code from the untrusted candidate with Staging credentials.

**Important:** a Staging experiment on the shared, long-lived Staging
database risks drifting the Supabase migration ledger. Avoid an
apply-and-rollback sequence there unless a separately approved recovery
mechanism proves both schema and migration-history consistency. Prefer a
separately authorized disposable Staging database/branch with an explicit
cost, cleanup and rollback plan. Never infer disposable isolation from
the project name.

Current main-only `supabase-staging-sync-request.yml` remains unchanged.
The future candidate workflow cannot be installed through a Draft PR
without a controlled main merge, which may trigger Production deployment.
That installation itself therefore requires the necessary
`本番承認` before merge; actual hosted validation separately requires
`ステージング承認` tied to the exact target, scope and one execution.

Production, Vercel Preview and both Supabase environments remain untouched
by the offline contract.
