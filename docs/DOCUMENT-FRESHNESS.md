# NOVELIGHT Document Freshness Policy

**STATUS: CURRENT**

## Purpose

NOVELIGHT must not depend on a human or AI correctly guessing which document is newest. Current State is selected from fresh `origin/main` by the machine-readable registry in `docs/DOCUMENT-SOURCE-OF-TRUTH.md`.

The normal development path is intentionally short:

`fresh origin/main -> Fast Freshness Gate -> work`

A repository-wide or Git-history audit is an exception path, not a normal startup requirement.

## Status semantics

- `CURRENT`: may be selected as Current State for the role declared by the registry.
- `ARCHIVED`: retained as historical evidence/context. It may be opened for an explicitly historical investigation, but must not be selected as Current State.
- `SUPERSEDED`: a retained obsolete specification with an explicit `supersededBy` successor. It must not be selected as Current State.

No filename, date, file mtime, chat excerpt, local copy, or `LATEST` suffix can change these meanings.

`docs/NOVELIGHT-MASTER.md` is a singleton role. Only the exact file registered as `CURRENT` on fresh `origin/main` is valid as the MASTER. Old MASTER content belongs in Git history rather than parallel `MASTER-old`, `MASTER-backup`, or dated MASTER copies in the normal docs area.

## Fast Freshness Gate

Normal startup performs only bounded checks against fresh `origin/main`:

1. `origin/main` was fetched successfully and resolves to one 40-character SHA.
2. the Source of Truth registry exists and is `CURRENT`;
3. the registered MASTER exists, is `CURRENT`, and the `master` singleton role is unique;
4. all startup-required formal guides exist and are `CURRENT`;
5. any task-specific guide selected for Current State is `CURRENT`;
6. a selected `ARCHIVED` or `SUPERSEDED` document fails closed;
7. every `SUPERSEDED` entry has one registered `CURRENT` successor;
8. singleton Current roles are unique;
9. a compact manifest records the main SHA, registry blob, MASTER blob, selected guide blobs, and statuses.

This path parses one small registry and resolves only the listed Git blobs. It does not read all docs, walk all Git history, or rebuild the complete reference graph.

## Detailed Freshness Audit

Escalate to the detailed audit only when the fast gate or CI finds an anomaly, including:

- duplicate `CURRENT` singleton roles;
- registry/file mismatch;
- unregistered formal document;
- unknown or unsupported status;
- missing or non-current successor;
- missing current reference;
- Current State reference to `ARCHIVED`/`SUPERSEDED` without an explicit historical-reference exception;
- ambiguous Source of Truth;
- inability to fetch/resolve current main;
- SHA inconsistency;
- an important specification whose Current State cannot be determined.

The audit may then inspect related document bodies, reference relationships, workflows/scripts/code, and targeted Git history. It reports findings only. It never auto-deletes or auto-moves files.

## Fail-Closed

Freshness failures are safety failures, not convenience warnings. Do not start or continue implementation when current main, the official MASTER, a unique Source of Truth, or an important task-specific current specification cannot be established.

Freshness failure is not eligible for Degraded Continue. Historical-only evidence is not a substitute for unknown Current State.

## Archive and supersession

Evidence, migration records, audit results, incident records, release decisions, and other durable history should normally be retained. Logical `ARCHIVED` status isolates them from Current State selection without destroying evidence.

A superseded specification remains readable for historical investigation, but its successor is the only current specification for that role.

Current documents may cite archived material only when the registry explicitly records that reference as historical. This prevents a historical citation from silently becoming a Current State dependency.

## Deletion protection

The first freshness-system PR performs no physical deletions. The initial inventory has zero delete candidates and zero unresolved hold candidates.

Future physical deletion must be a separate, explicit review when practical. Never delete because a filename looks old, a date is old, Git can restore it, or it probably is not used. A file is not deletion-eligible while it is `CURRENT`, unresolved, referenced by a current document without an intentional migration plan, used by CI/workflow/script/code, lacks a confirmed successor, or has durable evidence value.

## AI / Codex usage

For implementation work, use the existing Codex-first gate. After the mandated latest-main and full-MASTER bootstrap, the runtime gate validates the document registry before implementation proceeds. Task-specific formal guides should be passed to the freshness checker as selected guides; choosing an archived or superseded guide as Current State fails closed.

Historical investigations may deliberately read `ARCHIVED`/`SUPERSEDED` documents, but those reads must be marked historical and must not change the Current State manifest.

## Initial inventory result

The initial read-only inventory classified:

- current formal guides/runbooks/current-state documents as `CURRENT`;
- `BETA-RELEASE-DECISION-2026-08-28.md`, dated release evidence snapshots, and the original 2026-08-26 legal review packet as `ARCHIVED`;
- `exposure-allocation-beta.md` as `SUPERSEDED` by `exposure-allocation-beta-v2.md` because the old document describes a caller-controlled impression recorder that the later trusted-allocation-receipt design revoked;
- no file as a physical deletion candidate in the first PR.

The dated `LEGAL-COUNSEL-HANDOFF-2026-08-28.md` remains `CURRENT` because its content explicitly defines the current counsel handoff. This is a deliberate guard against date-based automatic archival.
