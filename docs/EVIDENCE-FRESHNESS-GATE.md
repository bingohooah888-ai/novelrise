# NOVELIGHT EVIDENCE FRESHNESS GATE

This file is the fail-closed contract for deciding whether a NOVELIGHT task, release gate, Production proof, deployment, or external-service operation is already complete or must be run again.

## 1. Historical documents are snapshots, not current state

Dated release-evidence files, checklists, chat summaries, issue descriptions, and prior status reports describe the state observed at their own point in time. They must never be treated as the current state without checking for newer evidence.

In particular, an older `OPEN`, `PENDING`, `NOT YET RECORDED`, or unchecked item must not override a later successful workflow, approval ledger entry, deployment observation, or live read-only verification for the same scope.

Likewise, an older `PASS` must not be reused blindly after a later material change that can invalidate the proof.

## 2. Evidence resolution order

Before making a current-state claim about release readiness or before repeating deploy/Vercel/Supabase/Stripe work, resolve the evidence in this order:

1. Fetch the latest `main` SHA.
2. Read the newest relevant release-evidence/current-state document only as a starting snapshot.
3. Find the newest relevant GitHub Actions workflow runs and inspect the decisive job/step result, not only the workflow title.
4. For Production operations, inspect the approval/consumption ledger when one exists and bind the proof to its exact run ID and commit SHA.
5. Compare the successful proof SHA with current `main` and identify later changes that touch the proved behavior, target environment, security boundary, or control path.
6. Use current read-only external-state observations when available and safe.
7. Classify the prior proof as `current`, `refresh-required`, or `unknown`.

`unknown` is fail-closed. Do not mutate Production merely to discover whether an older operation was already completed.

## 3. Recency and specificity rule

For the same scope, newer specific execution evidence supersedes older descriptive status text when no later material change invalidates it.

Examples:

- A dated release note says `External Stripe -> Production webhook: OPEN`, then a later GitHub Actions run proves the external webhook path and the approval ledger records `CONSUMED ... result:"success"`. The current state is the later successful proof unless a subsequent relevant change invalidates it.
- A workflow passed, then `api/stripe-webhook.js`, the webhook secret/endpoint, Production Supabase target, or the proof implementation materially changed. The earlier proof is no longer sufficient; classify it `refresh-required`.
- A later change only updates unrelated documentation or user-facing copy and does not touch the proved path or target state. Do not invalidate the proof merely because `main` advanced.

When evidence conflicts, compare both **time** and **scope**. A newer but unrelated event does not supersede a more specific proof for another scope.

## 4. Duplicate Production mutation block

Before any Production deploy, Vercel environment synchronization, Supabase mutation, Stripe live operation, webhook repair, or equivalent external-state mutation:

- search for the newest same-purpose successful proof;
- verify whether later relevant changes invalidate that proof;
- record the evidence source and observation time;
- explicitly decide whether the existing proof is `current` or `refresh-required`.

If the existing proof is `current`, repeating the same Production mutation is prohibited. Report that the gate is already satisfied and move to the next genuinely open item.

If it is `refresh-required`, explain the invalidating change and continue only within the currently approved Production scope.

If it is `unknown`, stop before mutation and gather better read-only evidence.

## 5. Runtime Gate evidence

For `deploy`, `vercel`, `supabase`, and `stripe` Runtime Gate phases, the caller must provide evidence-freshness proof:

- `--evidence-freshness-checked`
- `--evidence-duplicate-check`
- `--evidence-source=<workflow/run/ledger/current-state source>`
- `--evidence-observed-at=<ISO-8601 timestamp>`
- `--evidence-verdict=current|refresh-required`
- optional `--evidence-proof-sha=<40-hex commit>`
- `--mutation-planned` when the next action will mutate external state

Equivalent environment variables are supported with the `NOVELIGHT_EVIDENCE_*` prefix and `NOVELIGHT_MUTATION_PLANNED=1`.

A mutation with `evidence-verdict=current` must fail closed as a duplicate operation. A mutation may proceed only with `refresh-required` plus all ordinary approval/safety gates.

This Runtime Gate evidence does not itself prove that the remote lookup was performed correctly; it makes the check explicit, auditable, regression-tested, and impossible to omit accidentally on the local/runtime-capable path.

## 6. Cloud / Connector path

Cloud assistants that cannot run the local Runtime Gate must perform the same resolution with Connector/API reads before Production mutation or a release-state conclusion.

The minimum cloud evidence is:

- latest `main`;
- newest relevant workflow run/job result;
- approval ledger evidence when applicable;
- proof-SHA versus current-main comparison for later material changes;
- current read-only external state when needed and available.

A historical evidence document alone is never sufficient to justify repeating a Production operation.

## 7. Release-evidence maintenance

Dated evidence files remain immutable historical snapshots unless they contain a factual error in the snapshot itself.

Maintain `docs/BETA-RELEASE-EVIDENCE-LATEST.md` as a rolling current-state index. It is a convenience index, not a substitute for fresher workflow/live evidence. When a newer decisive proof exists, reconcile the rolling index rather than rewriting history in an older dated record.

## 8. Regression requirement

CI must retain tests that prove:

- the Runtime Gate loads this contract as an authoritative main file;
- deploy/Vercel/Supabase/Stripe phases reject missing evidence-freshness proof;
- malformed/unknown freshness verdicts fail closed;
- a planned mutation is rejected when the existing proof is `current`;
- `refresh-required` can pass the freshness layer but does not bypass ordinary Production approvals;
- the cloud contract forbids using an older release-evidence snapshot as the sole current-state source.
