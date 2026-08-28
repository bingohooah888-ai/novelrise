# NOVELIGHT chat-approved Production dispatch

This control removes the manual GitHub Actions `Run workflow` click after an explicit Production approval has already been given in ChatGPT. It does not remove the human Production approval itself and does not bypass the downstream `production-approval` GitHub Environment.

## Initial allowed operation

The bridge is intentionally not a generic workflow launcher. The only accepted operation is:

- `supabase-baseline-history-repair`
  - target workflow: `.github/workflows/supabase-production.yml`
  - ref: `main`
  - mode: `repair-history`
  - confirmation: `REPAIR`
  - repair version: `20260815000000`

No workflow name, ref, mode, confirmation, migration version, Supabase project, or credential is accepted from the approval comment as a free-form dispatch parameter.

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
- the one-time `challenge` has not already been claimed or dispatched for the same operation/SHA;
- the ledger is still within the bounded comment contract.

The bridge records `NOVELIGHT_PRODUCTION_DISPATCH_CLAIMED` before calling the GitHub Actions dispatch API and `NOVELIGHT_PRODUCTION_DISPATCHED` only after GitHub returns HTTP 204. A failed post-validation dispatch records `NOVELIGHT_PRODUCTION_DISPATCH_FAILED` and is not silently retried.

## Downstream safety remains authoritative

The bridge contains no Supabase credentials and performs no database mutation itself. It only dispatches the fixed workflow.

`supabase-production.yml` remains responsible for all mutation safety checks, including:

- `PRODUCTION_APPROVAL_GATE_READY=true`;
- `production-approval` Environment human approval;
- exact `REPAIR` confirmation;
- repair version fixed to `20260815000000`;
- proof that the baseline is still pending;
- fresh read-only verification that the historical Production core tables exist;
- post-mutation migration status and Production observability verification.

A chat approval therefore replaces only the manual workflow-start click. It does not authorize any other Production migration or remove the GitHub Environment approval gate.

## Freshness and replay rules

Approvals are SHA-bound and one-time. If `main` advances after the approval comment, the bridge must fail closed and a fresh explicit Production approval is required. If a dispatch was already claimed or dispatched, the same approval cannot be reused.

New Production operation types must not be added as free-form inputs. Each new operation requires a separate reviewed code change that hard-codes its target workflow and arguments, adds regression tests, and preserves the ordinary Production approval and evidence-freshness gates.
