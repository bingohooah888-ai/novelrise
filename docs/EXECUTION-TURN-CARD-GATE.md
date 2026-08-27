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
- one of the two time modes below

### Timed mode

Use only when the execution environment permits time estimates.

The card must include:

- `トータル予想時間`
- major-step estimates

### Degraded mode

Use when a higher-level execution constraint prohibits time estimates.

The card must include the exact meaning of:

`時間見積もり：実行環境の上位制約により省略。`

Omitting the time field entirely is invalid. Adding the degraded explanation later in the turn is also invalid.

## 3. First-message evidence

Local/runtime-capable agents must provide all of the following to the Runtime Execution Gate:

- card visible in the current assistant turn
- card was the first user-visible message of the turn
- explicit card mode (`timed` or `degraded`)
- a fresh execution-turn ID
- major steps
- manual-operation state/count
- wait requirement
- total time for timed mode, or omission reason for degraded mode

The Runtime Execution Gate must fail if any evidence is missing. It must not silently default the mode to timed.

## 4. Cloud / Connector path

A cloud assistant that cannot run the local Runtime Execution Gate is not exempt.

Its protocol is:

1. Send the execution card as the first visible message.
2. Only then call GitHub/Connector/API tools.
3. Re-fetch latest `main`, MASTER, Preflight, and this file before any mutation.
4. If the assistant notices that a tool was called before the card, stop mutations for that turn, report the gate failure, and start the next tool-using turn with a fresh card.

The cloud path cannot rely on `I remembered the rule` as evidence. The visible ordering in the conversation is the source of truth.

## 5. Regression rule

CI must keep tests that assert:

- this file remains part of the Runtime Gate authoritative file set;
- card mode is explicit;
- first-message evidence is mandatory;
- a fresh turn ID is mandatory;
- degraded mode requires an omission reason;
- timed mode requires a total estimate.

The purpose is to make a missing execution card a detectable contract violation instead of a style preference.
