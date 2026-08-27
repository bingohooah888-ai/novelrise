# NOVELIGHT EXECUTION TURN CARD GATE

This file is the fail-closed contract for the first user-visible message of every NOVELIGHT assistant turn that will use tools.

## 1. Zero-tool rule

Before any GitHub/Connector/API/CLI/Workflow/file operation, including read-only discovery or latest-main lookup, the assistant must first send one user-visible execution card in the current turn.

A card from a previous user turn is invalid. A user message such as `はい`, `続けて`, a screenshot, a log, or a manual-operation completion report always starts a new execution turn and invalidates the previous card.

## 2. Required card fields

The first visible message must contain all of the following:

- `目的`
- `主要工程`
- `手動操作`
- `待機`
- `作業量`
- `別作業`
- `次のユーザー操作`
- one of the two time modes below

`作業量` is a qualitative estimate that remains required even when numeric time estimates are prohibited. Use a clear level such as `ごく短い`, `短い`, `中程度`, `長い`, or `かなり長い`.

`別作業` must state whether the user can safely switch to other work while NOVELIGHT work proceeds. Prefer a direct statement such as `して大丈夫です` or `この工程では画面確認が必要です`.

`次のユーザー操作` must state the next condition that genuinely requires user involvement. If no user action is expected, say `なし` rather than inventing a confirmation step.

### Timed mode

Use only when the execution environment permits time estimates.

The card must include:

- `トータル予想時間`
- major-step estimates

### Degraded mode

Use when a higher-level execution constraint prohibits time estimates.

The card must include the exact meaning of:

`具体的な所要時間：実行環境の制約により表示できません。`

In degraded mode, `作業量`, `別作業`, and `次のユーザー操作` are the required replacement decision-support information. The user must be able to decide whether to stay on the current task or switch to other work without needing a numeric duration.

Omitting the time field entirely is invalid. Adding the degraded explanation later in the turn is also invalid.

## 3. Local/runtime-capable path

Local/runtime-capable agents must pass the existing Runtime Execution Gate with current-turn card evidence.

The Runtime Execution Gate continues to validate:

- current-turn card visibility acknowledgement;
- major steps;
- manual-operation state/count;
- wait requirement;
- qualitative workload;
- whether other work is safe;
- the next user-action condition;
- total time in timed mode;
- omission reason in degraded mode.

This file is also part of the authoritative files fetched by the Runtime Execution Gate, so the dedicated first-message contract cannot be removed without breaking regression checks.

## 4. Cloud / Connector path

A cloud assistant that cannot run the local Runtime Execution Gate is not exempt.

Its protocol is:

1. Send the execution card as the first visible message.
2. Only then call GitHub/Connector/API tools.
3. Re-fetch latest `main`, MASTER, Preflight, and this file before any mutation.
4. If the assistant notices that a tool was called before the card, stop mutations for that turn, report the gate failure, and do not treat a later card in the same turn as valid recovery.
5. The next tool-using turn must begin with a fresh card.

The cloud path cannot rely on `I remembered the rule` as evidence. The visible ordering in the conversation is the source of truth because the connector layer cannot inspect or block the chat UI before its first call.

## 5. Regression rule

CI must keep tests that assert:

- AGENTS, Preflight, and Automation Continuation Gate retain the first-visible-message rule;
- this file remains part of the Runtime Gate authoritative file set;
- every execution card carries workload, other-work guidance, and the next user-action condition;
- degraded mode requires an omission reason and the qualitative replacement guidance;
- timed mode requires a total estimate;
- the cloud path explicitly treats a late card as invalid for that turn.

The purpose is to make a missing execution card a detectable contract violation instead of a style preference, while being explicit about the platform boundary that repository code cannot directly enforce.