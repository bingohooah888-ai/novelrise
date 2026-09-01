# NOVELIGHT EVIDENCE FRESHNESS GATE

This file is the fail-closed contract for deciding whether a NOVELIGHT task, release gate, Production proof, deployment, or external-service operation is already complete or must be run again.

## 1. Historical documents and failures are snapshots, not current state

Dated release-evidence files, checklists, chat summaries, issue descriptions, prior status reports, workflow failures, error logs, and earlier screenshots describe the state observed at their own point in time. They must never be treated as the current state without checking for newer evidence.

In particular, an older `OPEN`, `PENDING`, `NOT YET RECORDED`, unchecked item, failed workflow, or missing-configuration error must not override a later successful workflow, approval ledger entry, deployment observation, current database state, or live read-only verification for the same scope.

Likewise, an older `PASS` must not be reused blindly after a later material change that can invalidate the proof.

A failed workflow explains what was wrong **when that run executed**. It does not prove that the same defect still exists now. Out-of-band manual work, another workflow, platform automation, branch recreation, or another actor may have changed the target state after the failure.

## 2. Evidence resolution order

Before making a current-state claim about release readiness, before repeating deploy/Vercel/Supabase/Stripe work, or before instructing a user to remediate an external-service failure, resolve the evidence in this order:

1. Fetch the latest `main` SHA.
2. Identify the exact target environment/resource and desired end state.
3. Read historical release evidence, failed runs, logs, and ledgers only as starting evidence.
4. Obtain a **fresh read-only observation of the current target state** whenever the platform safely exposes one. For databases this includes migration history/schema capability; for deployments/configuration it includes the current environment/deployment facts that prove the relevant state without exposing secrets.
5. Find the newest relevant GitHub Actions workflow runs and inspect the decisive job/step result, not only the workflow title.
6. For approval-controlled operations, inspect the approval/claim/consumption ledger when one exists and bind the proof to its exact run ID and commit SHA.
7. Compare the successful proof SHA with current `main` and identify later changes that touch the proved behavior, target environment, security boundary, or control path.
8. Classify the current state as `current`, `refresh-required`, or `unknown`.

`current` means the desired external state is already satisfied. `refresh-required` means fresh evidence proves the desired state is still missing or stale. `unknown` means the available evidence cannot safely establish either result.

`unknown` is fail-closed. Do not mutate an external service, reset credentials, request a Secret change, or ask for a new high-impact approval merely to discover whether an older failure still applies.

## 3. Recency and specificity rule

For the same scope, newer specific current-state or execution evidence supersedes older descriptive status text and older failures when no later material change invalidates it.

Examples:

- A dated release note says `External Stripe -> Production webhook: OPEN`, then a later GitHub Actions run proves the external webhook path and the approval ledger records `CONSUMED ... result:"success"`. The current state is the later successful proof unless a subsequent relevant change invalidates it.
- A Supabase Staging sync run fails because `STAGING_DATABASE_URL` was missing, but a later fresh Staging migration-history observation proves the exact target migration is already present. The failed run remains historical evidence, but remediation for that missing Secret must not be prescribed as necessary for that already-satisfied migration.
- A workflow passed, then `api/stripe-webhook.js`, the webhook secret/endpoint, Production Supabase target, or the proof implementation materially changed. The earlier proof is no longer sufficient; classify it `refresh-required`.
- A later change only updates unrelated documentation or user-facing copy and does not touch the proved path or target state. Do not invalidate the proof merely because `main` advanced.

When evidence conflicts, compare both **time** and **scope**. A newer but unrelated event does not supersede a more specific proof for another scope.

Do not invent the mechanism by which current state changed. If current state proves the goal is satisfied but no evidence identifies which actor/workflow applied it, report only that the goal is satisfied and that the application path is unproven.

## 4. External-state remediation and duplicate-operation block

This block applies to **Staging and Production**, and to both assistant-executed changes and user-directed remediation steps.

Before any deploy, Vercel environment synchronization, Supabase mutation, Stripe operation, webhook repair, Secret/configuration remediation, credential reset instruction, migration retry, or equivalent external-state operation:

- search for the newest same-purpose successful proof;
- obtain a fresh read-only observation of the current target state when safely available;
- verify whether later relevant changes invalidate that proof;
- record the evidence source and observation time;
- explicitly decide whether the desired state is `current`, `refresh-required`, or `unknown`.

If the desired state is `current`, repeating the same mutation or remediation is prohibited. Do not tell the user to add/reset/change a Secret, password, environment value, migration, or approval merely because an older run failed. Report that the old failure has been superseded for this scope and move to the next genuinely open item.

If it is `refresh-required`, explain the fresh evidence showing what is still missing and continue only inside the currently approved scope and ordinary safety boundaries.

If it is `unknown`, stop before remediation and gather better read-only evidence. A historical failure alone is not enough to choose a corrective write.

### User screenshot / UI evidence

A current screenshot may contribute to the fresh-state proof only when the exact environment/resource and decisive state are visibly identifiable. Do not infer hidden migration IDs, credential validity, or configuration contents from a label that merely looks related.

When a current screenshot and an older workflow conflict, verify the exact scope with repository metadata/API/current read-only evidence when safely available before prescribing a write. Production/Staging labels, project refs, branch names, and migration names must be matched exactly rather than assumed.

## 5. Runtime Gate evidence

For `deploy`, `vercel`, `supabase`, and `stripe` Runtime Gate phases, the caller must provide evidence-freshness proof:

- `--evidence-freshness-checked`
- `--evidence-duplicate-check`
- `--evidence-source=<workflow/run/ledger/current-state source>`
- `--evidence-observed-at=<ISO-8601 timestamp>`
- `--evidence-verdict=current|refresh-required`
- optional `--evidence-proof-sha=<40-hex commit>`
- `--current-state-checked`
- `--current-state-source=<fresh read-only current-state source>`
- `--mutation-planned` when the next action will mutate external state
- `--remediation-planned` when the next action or user instruction would change external state/configuration to fix a prior failure

Equivalent environment variables are supported with the `NOVELIGHT_EVIDENCE_*` prefix, `NOVELIGHT_CURRENT_STATE_CHECKED=1`, `NOVELIGHT_CURRENT_STATE_SOURCE`, `NOVELIGHT_MUTATION_PLANNED=1`, and `NOVELIGHT_REMEDIATION_PLANNED=1`.

The current-state source must identify a fresh observation such as current/live/remote database state, environment facts, migration parity/history, deployment state, or another direct read-only target observation. A workflow failure, old log, release document, or ledger by itself cannot satisfy `current-state-source`.

A mutation or remediation with `evidence-verdict=current` must fail closed as a duplicate/stale-failure operation. Mutation/remediation may proceed only with `refresh-required` plus all ordinary approval/safety gates.

This Runtime Gate evidence does not itself prove that the remote lookup was performed correctly; it makes the current-state check explicit, auditable, regression-tested, and impossible to omit accidentally on the local/runtime-capable path.

## 6. Cloud / Connector path

Cloud assistants that cannot run the local Runtime Gate must perform the same resolution with Connector/API reads before external-state remediation, Production mutation, Staging mutation/retry, Secret/configuration repair guidance, or a release-state conclusion.

The minimum cloud evidence is:

- latest `main`;
- exact target environment/resource and desired end state;
- a fresh read-only current-state observation when safely available;
- newest relevant workflow run/job result;
- approval/claim/consumption ledger evidence when applicable;
- proof-SHA versus current-main comparison for later material changes.

A historical evidence document, failed workflow, or error log alone is never sufficient to justify repeating an operation or telling the user to alter a Secret/password/configuration.

If the fresh observation already proves the goal is satisfied, the assistant must stop the remediation path even when an older run failed. It may separately record that the cause/path of the later state change is unknown, but must not convert that uncertainty into another write.

### Production Authenticated Smoke classification

A green top-level Production Auth Smoke-related workflow run is **not** sufficient PASS evidence by itself. Request-only runs, workflow-dispatch forwarding runs, expired or unapproved requests, and runs whose decisive verification job is `skipped` must never be classified as authenticated Production PASS.

A Production Authenticated Smoke may be classified as PASS only when `scripts/evaluate-production-auth-smoke-evidence.mjs` accepts the evidence set for the exact required release SHA. The evaluator must require all of the following:

- the expected Auth Smoke verification/approval-handler workflow and `issue_comment` execution path;
- top-level workflow conclusion `success`;
- exactly one `Verify authenticated beta-critical production flows` job with conclusion `success`;
- exactly one matching `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED` record authored by GitHub Actions, with `result:"success"`, the same workflow run ID, and the same exact head SHA.

If any one of those conditions is absent, malformed, duplicated, skipped, stale, or bound to a different SHA/run, the Auth Smoke proof is `unknown` or `refresh-required`, never PASS.

## 7. Release-evidence maintenance

Dated evidence files remain immutable historical snapshots unless they contain a factual error in the snapshot itself.

Maintain `docs/BETA-RELEASE-EVIDENCE-LATEST.md` as a rolling current-state index. It is a convenience index, not a substitute for fresher workflow/live evidence. When a newer decisive proof exists, reconcile the rolling index rather than rewriting history in an older dated record.

## 8. Regression requirement

CI must retain tests that prove:

- the Runtime Gate loads this contract as an authoritative main file;
- deploy/Vercel/Supabase/Stripe phases reject missing evidence-freshness proof;
- external-state phases reject missing fresh current-state evidence;
- an old workflow failure alone cannot satisfy the current-state source requirement;
- malformed/unknown freshness verdicts fail closed;
- a planned mutation is rejected when the existing proof is `current`;
- a planned remediation is rejected when fresh evidence says the desired state is already `current`;
- `refresh-required` can pass the freshness layer but does not bypass ordinary approvals;
- the cloud contract forbids using an older release-evidence snapshot or failed workflow as the sole current-state source;
- the cloud contract covers Staging and Secret/configuration repair guidance, not only Production mutations;
- Auth Smoke request-only or skipped-verification runs cannot be classified as PASS;
- Auth Smoke PASS requires a successful decisive verification job plus a matching successful consumed-approval ledger record bound to the exact run ID and head SHA.
