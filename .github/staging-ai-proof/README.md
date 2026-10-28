# NOVELIGHT staging AI review — dormant trusted-runner proposal

This branch proposes only `.github/` and `tests/` changes. This is NOT
approval to merge or execute anything against hosted Staging.

The existing `scripts/vercel-ignore-build.mjs` permits skipping Production
builds when **every changed file** is under `.github/` or `tests/`, provided
Vercel can determine a one-parent Git diff. If diff context is unavailable,
that script fails open, so a main update **could still cause a Production
deployment**. The ignore build step alone is NOT proof of zero impact.
The existing `vercel.json` has `git.deploymentEnabled.main=true`.

The isolated source is copied from Draft PR #2601 at
`16e27e9849c57872253164535fb99feb721e225c`.
When approved, use the **trusted main copy** of the scripts only.
The runner references existing main helpers
`scripts/verify-staging-migration-target.mjs` and
`scripts/resolve-staging-session-pooler.mjs`.

## Independent approval boundaries

1. **Main integration**: owner explicitly approves this isolated PR,
   with awareness of possible Production build/deployment. The code remains
   dormant immediately after merge. Do not merge the full Draft PR #2601.
2. **Hosted Staging synthetic DB writes**: only after step 1 and a fresh,
   separate one-use OWNER approval comment on control Issue #294, pinning
   exact main SHA, Draft candidate SHA, approved staging project and migration.
   A generic `続けて` or a previous migration approval is insufficient.
3. **Real JWT/Preview**: excluded here. Real Supabase Auth sign-in, a
   protected pinned Vercel Preview and separate synthetic user ...943
   require their own independent approval.

The DB-only proof uses reserved fake Auth users ...941 and ...942, draft
novel 998891001 and draft episode 998891002, checks real two-session races,
role restrictions, evidence freshness, rollback and scoped cleanup.
Never enable AI, change model budgets or touch Production Supabase.

SIGKILL, runner loss, connection faults and incomplete cleanup may leave
synthetic rows. Fail closed, no automatic retry; inspect read-only first,
then seek narrowly scoped approval for any manual exact-ID cleanup.

## Before any merge

- Confirm actual PR diff changes only `.github/` and `tests/`.
- All offline CI checks, disposable RLS and CodeQL pass.
- Main, draft candidate and Staging preflight must be rechecked.
- No previous OWNER marker in Issue #294 can be reused.
- Verify Vercel deployment suppression independently or obtain explicit
  owner approval for the remaining Production deployment risk.

Rollback: revert the narrow main promotion commit or disable the specific
workflow. Revert itself is a main change and must be treated accordingly.
