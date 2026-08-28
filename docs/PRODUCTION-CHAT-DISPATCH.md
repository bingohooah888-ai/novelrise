# NOVELIGHT chat-approved Production execution

This control treats the explicit Production approval already given in ChatGPT as the human approval for one fixed Production action. It removes both the manual GitHub Actions `Run workflow` click and the duplicate `production-approval` Environment review for that chat-approved path.

It does **not** remove the ordinary manual fallback approval. `.github/workflows/supabase-production.yml` remains unchanged and still requires the `production-approval` GitHub Environment for manual `repair-history` or `deploy` runs.

## Initial allowed operation

The bridge is intentionally not a generic Production executor. The only accepted operation is:

- `supabase-baseline-history-repair`
  - trigger: a new owner-authored approval record on Production Approval Ledger issue #165
  - approved ref: exact current `main` SHA
  - repair version: `20260815000000`
  - Supabase project: fixed Production project
  - database action: `supabase migration repair --status applied 20260815000000`

No workflow name, ref, mode, confirmation, migration version, Supabase project, credential, SQL, or command is accepted from the approval comment as a free-form execution parameter.

## Approval record

After the user explicitly approves this exact Production operation in ChatGPT, the assistant may record one machine-readable approval comment on Production Approval Ledger issue #165:

```text
NOVELIGHT_PRODUCTION_DISPATCH_APPROVE {"operation":"supabase-baseline-history-repair","mainSha":"<40-hex-current-main>","challenge":"<8-uppercase-hex>","repairVersion":"20260815000000"}
```

The workflow accepts the comment only when all of the following are true:

- the event is a new comment on issue #165, not a pull request;
- the comment author is the repository owner `bingohooah888-ai` with `OWNER` association;
- the JSON has exactly the four documented keys and the exact operation/version;
- `mainSha` is exactly the current `main` commit when validation runs;
- the one-time `challenge` has not already been claimed, dispatched, or executed for the same operation/SHA;
- the ledger is still within the bounded comment contract.

The bridge re-checks `main`, then records `NOVELIGHT_PRODUCTION_DISPATCH_CLAIMED` immediately before entering the Production execution job. The Production job independently re-reads the ledger and requires exactly one matching claim bound to the same workflow run ID, SHA, challenge, operation, and repair version.

A successful repair records `NOVELIGHT_PRODUCTION_EXECUTED`. A failed Production execution records `NOVELIGHT_PRODUCTION_EXECUTION_FAILED`; it is not silently retried.

## Manual fallback remains protected

The manual workflow `.github/workflows/supabase-production.yml` remains the fallback for `status`, `dry-run`, `repair-history`, and `deploy`.

Manual mutation runs still require:

- exact typed confirmation (`REPAIR` or `DEPLOY`);
- `PRODUCTION_APPROVAL_GATE_READY=true`;
- `production-approval` GitHub Environment human approval;
- the existing Production checks inside the workflow.

The chat-approved path does not weaken or bypass those checks for a manually started run.

## Chat-approved Production boundary

For the one fixed chat-approved baseline repair, `.github/workflows/production-approved-dispatch.yml` performs the Production operation directly from its owner-only `issue_comment` trigger after the ledger approval has been validated and claimed.

Before touching Supabase it must:

- re-check that current `main` still equals the approved SHA;
- re-read issue #165 and find exactly one matching `NOVELIGHT_PRODUCTION_DISPATCH_CLAIMED` record for the same workflow run;
- check out exactly the approved commit;
- use only the fixed Production project and fixed repair version;
- use the repository's shared `supabase-production-migration` concurrency lock.

The Production repair then retains the same database safety checks as the manual fallback:

- repair version fixed to `20260815000000`;
- proof that the baseline is still pending;
- fresh read-only verification that the historical Production core tables exist;
- `supabase migration repair --status applied` only for that fixed version;
- post-mutation migration status;
- Production observability verification and commit status publication.

The bridge contains no generic deploy path and must not execute `supabase db push --yes`.

## Stale waiting-run cleanup

The first version of the bridge dispatched `.github/workflows/supabase-production.yml`, which can leave a bot-started run waiting at `production-approval`.

Before the new chat-approved execution starts, the bridge checks active manual Supabase Production runs:

- any human-started active run causes a fail-closed stop;
- more than one active bot-started manual run causes a fail-closed stop;
- a single bot-started run is cancellable only when issue #165 contains exactly one matching prior `NOVELIGHT_PRODUCTION_DISPATCHED` record for the same old main, fixed baseline repair version, and `supabase-production.yml` target;
- one verified bot-started run from an older main may be cancelled and must reach `cancelled` before the repair can continue;
- a bot-started run already targeting the newly approved main causes a fail-closed duplicate stop.

After that cleanup, the Production repair job uses the same `supabase-production-migration` concurrency group as the manual workflow, so the two mutation paths cannot intentionally execute concurrently.

## Freshness and replay rules

Approvals are SHA-bound and one-time. If `main` advances after the approval comment, the bridge must fail closed and a fresh explicit Production approval is required. If an approval was already claimed or executed, the same approval cannot be reused.

Evidence Freshness remains mandatory before a new approval record is written. If the same Production repair is already proven complete, it must not be repeated.

New Production operation types must not be added as free-form inputs. Each new operation requires a separate reviewed code change that hard-codes the scope, adds regression tests, preserves Evidence Freshness, uses an appropriate Production concurrency lock, and keeps manual fallback protections intact.
