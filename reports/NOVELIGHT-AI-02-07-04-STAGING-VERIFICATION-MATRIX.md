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
