# Community Phase 1 — separate rollback-only Staging executor (Draft only)

This workstream is isolated from Community Phase 1 **Draft PR #2222**.
Its own workflow must be independently reviewed before a main merge.

## Existing authorization boundaries

- Trigger: new **OWNER** comment on fixed Issue **#294** only, unique
  `NOVELIGHT_STAGING_COMMUNITY_CANDIDATE_APPROVE ` prefix.
- Exact request keys: `scope`, `mainSha`, `candidateSha`,
  `migration`, `confirmation`.
- Scope is exclusively `community-phase1-isolated`; migration
  `20261014052000`; confirmation `STAGING APPROVED`.
- PR #2222 must be open **Draft**, based exactly on current main, and
  provably ahead without divergence. Both Git SHA values are rebound
  before any database operation.
- Complete Issue #294 ledger must contain no consumed/claimed marker for
  the request. Immediately post `CLAIMED`, serialize with the existing
  migration-sync concurrency group, and always post `CONSUMED`.
- A rejected approval does not run a Staging job.
- This draft has no authority to create the OWNER comment or substitute
  previously granted preparation approval.

## Trusted code and SQL provenance

The runner checks out **current main**, not PR #2222. It downloads only
four SQL artifacts from the exact immutable candidate SHA and verifies
both the GitHub Contents API `.sha` and local `git hash-object`
against **hardcoded reviewed blob SHAs**. Any SQL change needs a new
independent review/updated manifest and approval.

Allowed SQL files are the versioned migration, precheck, postcheck and
read-only/RLS role assertions. **Candidate JS and test scripts are never
executed with Staging secrets.** No NPM dependencies are installed from
the candidate.

## Database isolation

The Staging job uses GitHub `environment: staging` and the existing
secret. The trusted main verifier enforces SSL and prevents Production
Supabase ref `fiepaguycecrredwrcwx`. It additionally pins the exact
Staging project URL to `wmlzjgvxgoyrovdhbqbg`.

Before any SQL transaction, it compares all migration versions currently
recorded in Staging against the canonical migration list on current
main. Drift or a pre-existing Community migration stops execution.

For testing, the runner strips only reviewed outer BEGIN/COMMIT/ROLLBACK
wrappers from each pinned SQL artifact and builds one new script with a
single BEGIN and final ROLLBACK. SQL errors disconnect the session, so
PostgreSQL must undo the transaction. The role tests and postcheck run
inside the same transaction. There is **no `supabase db push` and no
`supabase_migrations` ledger mutation**. Read-only ledger parity is
verified again after the rollback. A short lock timeout prevents
long-lived reader disruption.

This tests schema compatibility and RLS grants. It does **not** prove
full authenticated cross-user REST/browser behavior on hosted Staging.
That requires a separate approved scope; the cross-user fixture remains
isolated to disposable PostgreSQL CI.

## No-cost / approval / deployment boundaries

The PR is **Draft only**. A workflow in a PR branch is not active in the
default branch. **Do not merge without `本番承認`** because merges to
main may initiate Production deployment. Installing the workflow does
not itself authorize a Staging run. Actual invocation requires a new,
single-use user **`ステージング承認`** with exact current SHA/scope,
then an OWNER-authenticated Issue #294 request. Preview requires a
separate Issue #188 scope and approval. Production schema, public release
flag, payments and Vercel configuration remain untouched.

## Known limitations / review points

- Even rollback-only DDL briefly takes locks on a shared Staging DB.
  Reconfirm usage windows/active clients and the cost boundary.
- A malicious reviewed SQL blob could defeat wrapper-only inspection.
  The independent fixed blob review is a *hard boundary*, not a
  substitute for security review.
- Repeated execution needs fresh consent and refreshed ledger state.
- A failed job requiring recovery must not be retried automatically.
- The workflow and runtime gates are security-sensitive and require a
  separate security review plus Production approval for installation.
