# NOVELIGHT EXECUTION TURN CARD GATE

This file is the fail-closed contract for the first user-visible message of every NOVELIGHT assistant turn that will use tools.

## 1. Zero-tool rule

Before any GitHub/Connector/API/CLI/Workflow/file operation, including read-only discovery or latest-main lookup, the assistant must first send one user-visible execution card in the current turn.

A card from a previous user turn is invalid. A user message such as `はい`, `続けて`, a screenshot, a log, or a manual-operation completion report always starts a new execution turn and invalidates the previous card.

## 1.5 MASTER-first read gate

After the current-turn execution card is visible, the first read-only bootstrap must establish the latest `main` commit SHA and then **immediately fetch and read the current `main` version of `docs/NOVELIGHT-MASTER.md` before reading any other project document, PR, workflow, issue, deployment state, or implementation file.**

`MASTERを確認した` means the assistant actually read the current MASTER content. A filename check, existence check, blob/SHA lookup, search snippet, cached summary, prior-chat memory, project attachment, File Library copy, or a statement such as `MASTERに書いてある` is not sufficient evidence of reading it.

If the tool truncates the MASTER, the assistant must continue fetching the remaining ranges/chunks until the full current MASTER has been read. A partial excerpt is not a completed MASTER read.

The only repository-state read allowed before the MASTER content is the minimum lookup needed to resolve the repository and latest `main` SHA. Once that SHA is known, MASTER reading takes priority over all other repository reads.

The MASTER-read evidence is current-turn only. Every new user message that leads to a tool-using NOVELIGHT turn invalidates the previous turn's MASTER read together with the previous execution card. The assistant must repeat the latest-main lookup and current-MASTER read before continuing tool work.

If the latest `main` MASTER cannot be retrieved and read, fail closed: do not substitute an old copy and do not continue mutation or project-state work.

The purpose of this gate is to prevent a rule from existing in MASTER while the assistant acts without actually reading that rule in the current execution turn.

## 2. Required card fields

The first visible message must contain all of the following:

- `目的`
- `主要工程`
- `手動操作`
- `待機`
- `作業量`
- `次のユーザー操作`

`作業量` is a qualitative estimate that remains required even when numeric time estimates are prohibited. Use a clear level such as `ごく短い`, `短い`, `中程度`, `長い`, or `かなり長い`.

`別作業` is optional. Show it only when it provides non-default decision value, such as when the user must remain available, should not switch away, or a meaningful waiting window makes switching work useful. Do not emit a default `して大丈夫です` line on every card.

`次のユーザー操作` must state the next condition that genuinely requires user involvement. If no user action is expected, say `なし` rather than inventing a confirmation step.

### Time information

When the execution environment permits time estimates and the estimate is useful, include `トータル予想時間` and major-step estimates.

When higher-level execution constraints prohibit time estimates, omit time information from the user-visible card. Do not print a fixed explanation that time cannot be displayed. Local/runtime callers may still use `--card-mode=degraded`; `--card-reason` is optional internal metadata and is not a required user-visible field.

## 3. Local/runtime-capable path

Local/runtime-capable agents must pass the existing Runtime Execution Gate with current-turn card evidence.

The Runtime Execution Gate continues to validate:

- current-turn card visibility acknowledgement;
- major steps;
- manual-operation state/count;
- wait requirement;
- qualitative workload;
- the next user-action condition;
- total time in timed mode.

Passing a Runtime Gate check that files are reachable is not a substitute for reading MASTER. The agent must read the current `main` MASTER before interpreting project rules or entering implementation/state work; if the agent cannot read it in full, it must fail closed.

Optional `other work` and degraded-mode reason metadata may be recorded when useful, but they are not required card fields.

This file is also part of the authoritative files fetched by the Runtime Execution Gate, so the dedicated first-message contract cannot be removed without breaking regression checks.

## 4. Cloud / Connector path

A cloud assistant that cannot run the local Runtime Execution Gate is not exempt.

Its protocol is:

1. Send the execution card as the first visible message.
2. Only then call the minimum read-only lookup needed to resolve latest `main`.
3. Fetch and read the **full current `main` MASTER** from that resolved SHA before any other project-state or project-document read; if truncated, continue range/chunk reads until complete.
4. Only after MASTER reading is complete, re-fetch Preflight, this file, and `docs/EVIDENCE-FRESHNESS-GATE.md`, then gather any PR/workflow/deployment/implementation evidence needed for the task.
5. Do not mutate anything until the MASTER-first bootstrap and the remaining required authoritative-file bootstrap are complete.
6. If the assistant notices that a tool was called before the card, or that project-state/project-document reads were performed before the current MASTER was actually read, stop mutations for that turn, report the gate failure, and do not treat a later card or later MASTER read in the same turn as valid recovery.
7. The next tool-using turn must begin with a fresh card and a fresh latest-main/current-MASTER read.

The cloud path cannot rely on `I remembered the rule`, `MASTERに書いてある`, a prior-turn read, or cached/project-attached copies as evidence. The visible ordering plus current-turn GitHub reads are the source of truth because the connector layer cannot inspect or block the chat UI before its first call.

## 5. Evidence Freshness Gate

Before making a current-state claim about beta readiness, or before entering `deploy`, `vercel`, `supabase`, or `stripe` work, apply `docs/EVIDENCE-FRESHNESS-GATE.md`.

Historical release-evidence documents are snapshots. An older `OPEN`, `PENDING`, `NOT YET RECORDED`, or unchecked item must not be treated as current when a later same-scope workflow or Production approval ledger proves success. Conversely, an older `PASS` must be re-evaluated when later relevant changes can invalidate that proof.

Before repeating a Production mutation, the assistant must search for the newest same-purpose successful proof, inspect the decisive workflow job/log and approval ledger when applicable, compare the proof SHA against current `main` for later relevant changes, and classify the evidence as `current`, `refresh-required`, or `unknown`.

- `current`: the same Production mutation is already satisfied and must not be repeated.
- `refresh-required`: explain the invalidating change and continue only inside the currently approved Production scope.
- `unknown`: fail closed and gather better read-only evidence before mutation.

A cloud/Connector assistant must perform this resolution with Connector/API reads. A local/runtime-capable agent must additionally provide the evidence-freshness fields required by the Runtime Gate. A historical evidence document alone is never sufficient to justify a repeated Production operation.

## 6. Regression rule

CI must keep tests that assert:

- AGENTS, Preflight, and Automation Continuation Gate retain the first-visible-message rule;
- this file and `docs/EVIDENCE-FRESHNESS-GATE.md` remain part of the Runtime Gate authoritative file set;
- every execution card carries workload and the next user-action condition;
- other-work guidance is optional and must not be emitted as a default filler line;
- degraded mode may omit both the time estimate and a user-visible omission explanation;
- timed mode requires a total estimate;
- the cloud path explicitly treats a late card as invalid for that turn;
- the current-turn bootstrap requires latest-main resolution followed by a full current-MASTER read before other project reads;
- a prior-turn MASTER read, cached summary, attachment, existence/SHA check, or partial snippet cannot satisfy the MASTER-read gate;
- deploy/Vercel/Supabase/Stripe phases fail closed without evidence-freshness proof;
- current evidence blocks duplicate external-state mutation.

The purpose is to make a missing execution card, an unread MASTER, or stale-state assumption a detectable contract violation instead of a style preference, while being explicit about the platform boundary that repository code cannot directly enforce.
