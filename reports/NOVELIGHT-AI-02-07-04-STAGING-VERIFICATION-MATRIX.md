# NOVELIGHT AI 02-07-04 — staging verification matrix (NOT EXECUTED)

This is a verification plan, not permission to run staging or production SQL.
The SQL remains a proposal under `reports/sql/`; no formal migration is
created by this change. AI providers, author-facing controls and budgets remain OFF.

## Preconditions (fail closed)

1. Obtain fresh, explicit OWNER staging approval bound to the exact main SHA,
   one-time scope and the designated approval ledger. Do not infer approval
   from opening a PR, pushing a branch or running CI.
2. Confirm migration parity and inspect the pending migration set; keep
   production isolated. Establish a rollback plan and a disposable staging
   fixture owned by a test author.
3. Confirm the intended role grants and JWT verification configuration without
   logging tokens, service keys or unpublished manuscript text.
4. Use only synthetic fixture manuscripts. Never send any real novel to AI.

## Required live evidence after approval

| Case | Setup / action | Required observation |
| --- | --- | --- |
| Forged quote | Stage a candidate with evidence absent from current episode content | SQLSTATE 22023; no candidate inserted |
| Revised chapter | Compute source hash, then change title or body before staging | SQLSTATE 22023; no candidate inserted |
| Duplicate batch | Repeat same actor and request hash concurrently from two connections | Exactly one accepted batch; no duplicate rows |
| Revision race | Two connections decide the same pending candidate with identical expected revision | Exactly one update; the other returns zero rows or a denied/stale outcome |
| Edit versus decision | Hold an episode edit in connection A while B decides using the previous hash | B must wait on the lock and reject the stale hash after A commits |
| Rollback | Abort the transaction after staging or decision | No committed candidate/decision from the aborted transaction |
| Cross-author | Attempt to stage or decide another author's chapter | SQLSTATE 42501 or denied; no mutation |
| Browser role | Call both RPCs as anon and authenticated roles | EXECUTE denied; no candidate visibility |
| HTTP no JWT | Call owner-only endpoint with no bearer token | Denied, without data or service credentials |
| HTTP wrong JWT | Call owner-only endpoint with another account's valid JWT | Denied, without another author's data |
| HTTP valid owner | Use a test owner JWT on an explicitly enabled staging-only route | Only scoped synthetic data; no provider call |
| Feature OFF | Call the owner route with its gate disabled | 404; no service client initialization |

For concurrency evidence, record both session IDs, isolation level, statement
order, transaction boundaries, SQLSTATE/row counts, and final rows. A static
source-code check is **not** a substitute for these two-session observations.

For HTTP/JWT evidence, record status codes and redacted response shapes only.
A mock handler test is **not** a substitute for a live authenticated request.

## Stop / promotion boundary

If any test fails or the migration ledger drifts, stop without promoting SQL.
After staging proof, prepare a separately reviewed formal migration and
confirm that the Supabase GitHub App will not automatically apply it on PR
creation. Production migration, real AI calls, admin trial and public release
each require their own approval. Do not treat a green CI as approval.

## Read-only staging preflight evidence — 2026-10-28 (NOT a live test)

- GitHub main at preflight: `ceaf40f5503bb7eb801484471dc35e9de55a4ef2`; PR #2598 head: `2de8f26b237359268f538cbd306df3b8988050ff` (not merged).
- Supabase production ref `fiepaguycecrredwrcwx` and isolated staging ref `wmlzjgvxgoyrovdhbqbg` were identified. Their migration ledgers each contained **206 matching versions and names**, with no ledger-only differences at the time of the check.
- Staging `public.novels.id`, `public.episodes.id`, and `public.episodes.novel_id` are `bigint`; `novels.user_id` is `uuid`; `episodes.title` and `episodes.content` are nullable `text`. These are compatible with the proposed FK types and require null-aware test fixtures.
- Staging currently has **zero** `public.novelight_ai_review_candidates` tables and **zero** `novelight_ai_review_stage_batch` / `novelight_ai_review_decide` RPCs. Therefore **none of the live verification cases in the matrix has been executed**.
- Approval ledger Issue #294 accepts `migration-sync` only for an exact 14-digit formal migration version and current main SHA. The SQL remains in `reports/sql/*_PROPOSAL.sql` and is **not** a formal migration. Do not bypass the workflow by issuing DDL directly against staging.
- The proposal's hash serialization `pg_catalog.to_json(text)::text` was checked against Node `JSON.stringify([title, content])` using three synthetic PostgreSQL staging vectors: Japanese text, newline, and emoji/quote/backslash. All three SHA-256 values matched in the read-only staging comparison and independent Node calculation. The values were `9c75b5ea7a918989290ff9e6553947a9642e5b21c3d2e5357df89bb1bfdb13ad`, `e7927c331bc484adb17b76f4a624c112910be78eff3cef377a20e6f02b612818`, and `ed1134bd20fc529319822191a876b07a8a85209dec0fb7d20ff98ae47d0fe96a` respectively. This is limited evidence, not proof of every Unicode/control-character edge case.

**Next safe engineering step:** independently review the proposal, create a separately reviewed formal migration on a dedicated branch using the repository's prescribed migration workflow, and establish an exact-version staging approval ledger entry before any staging DDL. This read-only preflight is not a substitute for transaction-level concurrency evidence, HTTP/JWT checks, or rollback proof. Production remains untouched.

## 2026-10-28 formal staging admission review (read-only)

- Authenticated GitHub connector identity was confirmed as repository OWNER `bingohooah888-ai`. Issue #294 is open and has a separately enforced **candidate-db-persist** workflow `.github/workflows/staging-candidate-db-persistent-apply.yml`, in addition to the `migration-sync` contract described in the Issue body.
- The candidate-persist workflow accepts only a **draft PR** with an exact candidate SHA, a reviewed formal 14-digit migration filename, current main SHA, and the dedicated one-time `NOVELIGHT_STAGING_CANDIDATE_PERSIST_APPROVE` ledger format. Its workflow validates the reviewed file manifest before applying to Staging; it must not be bypassed by `execute_sql` DDL.
- Existing chat approval was for **AI 02-07-04 staging verification**, not a separately identified persistent candidate schema apply. It has **not** been represented as a candidate-persist ledger approval. The scope boundary requires explicit review of the exact migration and candidate PR before the ledger comment is posted.
- Required preparation: generate a formal migration filename via `supabase migration new` in an authorized repo workspace; retain candidate SQL as review-only until that separate draft PR exists; confirm no unapproved Production auto-apply; review full diff and rollback plan; then seek the exact candidate-persist approval. Do not claim any two-session or HTTP/JWT live tests have passed.

## Offline migration candidate generation (not executed)

- `scripts/prepare-ai-review-migration.sh` invokes `supabase migration new ai_review_candidates` on an authorized local checkout, verifies exactly one new CLI-generated migration, then copies the reviewed proposal SQL into it. It does **not** connect to Supabase, apply DDL, or edit a ledger.
- `tests/ai-review-migration-generator.test.mjs` checks that this generator stays offline-only. The actual CLI generation has **not** been run because no authorized connected workspace with the Supabase CLI was available in this session.
- Before any staging apply: review the resulting formal migration file, open a dedicated Draft PR, pin its exact SHA and migration version, and obtain the distinct candidate-db-persist approval through Issue #294. The chat's earlier staging verification approval must not be silently broadened.
