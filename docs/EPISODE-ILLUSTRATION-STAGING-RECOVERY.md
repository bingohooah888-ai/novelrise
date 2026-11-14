# PR #2861: isolated Staging recovery preparation (NOT executed)

## Verified blockers (2026-11-14 read-only)
- main `dd2fd41a09cd111d4084f6e6e5286faba5786709`; PR base pinned to main and Draft.
- Four authorised Staging-only SCOUT migration ledger entries exist and their versions/names/sha256/sizes match `supabase/staging-migrations`. DO NOT delete, fake, or rewrite them.
- One main-only missing Staging version is `20261110172000_author_reader_retention_cross_visit`; both RPC definitions on Staging are confirmed older and have SHA256 `84db65f80613f2e1e15cab8f66c973981bdd56260ac3b866da66b29284c67653`, `e2879f44469f2cc5d4f33d5969a4b8a85ae17fa13ffb50e93c87fa136be943c3`.
- Analytics migration exists in main but no main-level precheck/rollback pair. Its existing `supabase/checks/20261110172000_author_reader_retention_cross_visit_postcheck.sql` begins with a psql meta-command and is not directly usable by the generic candidate compiler.
- PNG migration `20261114121000` retains the existing `SECURITY DEFINER` registration RPC. This must NOT be hidden or rewritten to bypass the generic compiler.
- The current trusted workflow (checked out from main) will NOT run code committed only in this unmerged PR. No one-time OWNER approval has been issued through Issue #294 for these changes.

## Prepared, no DB change
1. `precheck.sql` is read-only, rejects any drift in the two Staging RPC definitions, permissions or migration ledger.
2. `rollback.sql` has the **actual pre-migration Staging SQL** for both RPCs and refuses rollback unless the expected analytics migration is installed. It restores functions and their privileges, asserts baseline hashes and then deletes only this version's **migration ledger metadata row**, in one PostgreSQL transaction. It is NOT auto-run and requires a separate exact-scope Staging rollback approval.
3. PNG candidate `scripts/staging-illustration-pinned-sql.mjs` compiles exactly one reviewed Git-blob-locked migration; separate `check` (ROLLBACK) and `persist` (single COMMIT + ledger) modes. Existing main trusted candidate workflows are prepared to route **only** PR #2861 + version `20261114121000` there; generic SECURITY DEFINER ban and one-use OWNER Issue #294 approval remain intact.
4. Newly added tests require all four Git blobs to remain unchanged. If SQL changes, a new independent review and pin update is REQUIRED.

## Required deployment order and approval boundaries
A. **Do not merge PR #2861 to unblock Staging.** Its application code would also be included in the normal Production deployment while Production DB is still WebP-only.
B. With separate review/approval, place only the narrowly scoped trusted staging-runner changes on main, leaving PR #2861 unmerged. This requires a separately approved repository workflow change; none is performed in this task. Standard GitHub Action issue_comment triggers load workflows from main, never from candidate.
C. Independently recover Staging analytics migration `20261110172000` after a fresh read-only precheck and backup, using trusted Staging identity proof, complete Staging-only four-blob digest checks, single-transaction actual SQL + existing postcheck + migration ledger commit. An explicit dedicated OWNER Staging scope is needed; never count this task's approval as permission for unrelated analytics migration.
D. Only after true Staging history parity, use a separately approved one-time exact PR head + current main SHA for pinned PNG migration check and then persistent apply, followed by genuine private Storage signed PNG upload, finalize, manuscript insertion, reader display, ZIP export, existing WebP regression and cleanup.
E. Separate Production DB approval and separate PR main-merge approval later, including Production deployment implications.

**Important:** The recovery kit is preparatory. It is NOT an existing issue_comment workflow nor an authorisation to run psql or to mutate live Staging. To run it, a trusted main-only execution route with human review must first be independently installed. The current session performs zero DB writes, Production changes, Preview creation, or approval ledger CLAIM/CONSUME.
