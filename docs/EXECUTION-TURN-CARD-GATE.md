# NOVELIGHT EXECUTION TURN CARD GATE

This file is the fail-closed contract for the first user-visible message of every NOVELIGHT assistant turn that will use tools.

## 1. Zero-tool rule

Before any GitHub/Connector/API/CLI/Workflow/file operation, including read-only discovery or latest-main lookup, the assistant must first send one user-visible execution card in the current turn. In other words, the execution card is the first visible message for a tool-using NOVELIGHT turn.

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

### Conditional image-execution proof: project-wide hard lock

ChatGPT-side image-generation and image-editing tools are locked by default for every new NOVELIGHT user message. Before generic tool routing, the assistant must independently decide both the current-message image-tool unlock and the current-message image execution permission defined in `docs/IMAGE-EXECUTION-GATE.md`.

If the turn intends to call an image-generation or image-editing tool, the execution card must additionally contain all four fields before that tool call:

- `画像ツールロック解除: YES`
- `ロック解除命令引用: <現在のユーザーメッセージからの原文引用>`
- `画像実行判定: YES`
- `明示命令引用: <現在のユーザーメッセージからの原文引用>`

The default on every new user message is both:

`CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = NO`

`CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO`

A normal editing/generation instruction is not enough to unlock ChatGPT-side image tools. Wording such as `作って`, `生成して`, `編集して`, `修正して`, or `改善して` may express execution intent, but the image tool still stays locked unless the same current user message also explicitly and directly unlocks/re-enables the ChatGPT image-tool lock.

If the exact current-message lock-unlock phrase cannot be quoted, the unlock decision remains `NO`. If the exact current-message phrase authorizing actual image execution cannot be quoted, the execution decision remains `NO`. If either is `NO`, image-generation/editing tools are excluded from the candidate set and the turn must remain text-only for image consultation or acknowledgement.

Desired-state, consultation, continuation, and approval wording such as `文字をもう少し小さくしたい`, `両側にロゴでも入れる？`, `完璧`, `いいね`, `これでOK`, `はい`, or `続けて` does not satisfy either proof by itself and must not be silently rewritten into an editing or unlock command.

A previous-turn lock unlock or image instruction cannot satisfy the current proof. A new user message invalidates both permissions just as it invalidates the ordinary execution card.

A prohibited image-tool call is a gate violation at call time even if no image ultimately renders.

Stronger individual locks, including the current Noctar/ComfyUI lock, remain higher priority than this general hard-lock proof.

### Visual-input image-decision visibility: mandatory deny-state proof

When the **current NOVELIGHT user message contains or attaches an image or screenshot and the assistant turn will use any tool**, the execution card must always expose both current-message image decisions **before any tool call**, even when the turn does not intend to call an image-generation or image-editing tool:

- `画像ツールロック解除: YES | NO`
- `画像実行判定: YES | NO`

This is a visible pre-routing decision, not an image-execution request. Its purpose is to make the default deny state observable before a screenshot or image can accidentally trigger generic image-tool routing.

An image or screenshot attachment by itself must surface:

`画像ツールロック解除: NO`

`画像実行判定: NO`

unless the same current user message independently satisfies the explicit unlock and explicit execution requirements defined above.

When a decision is `NO`, the assistant must not invent a supporting quote. `ロック解除命令引用` and `明示命令引用` are required only for the corresponding `YES` proof used to authorize actual image-tool routing. A `NO` decision may omit the quote field or show it as `なし`.

This visibility requirement applies to tool-using turns whose purpose is otherwise unrelated to image generation, including GitHub investigation, bug analysis, Vercel checks, implementation work, or other tool work started from a screenshot/image message. If either decision is `NO`, image-generation/editing tools remain excluded from the candidate set for that turn.

A screenshot/image message answered entirely without tools still follows the existing zero-tool path and does not require an execution card merely because visual input exists.

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
- total time in timed mode;
- current-message image-tool unlock evidence when `--phase=image` is used;
- separate current-message explicit image-execution evidence when `--phase=image` is used.

Passing a Runtime Gate check that files are reachable is not a substitute for reading MASTER. The agent must read the current `main` MASTER before interpreting project rules or entering implementation/state work; if the agent cannot read it in full, it must fail closed.

For an image phase, a visible card alone is not enough. The runtime caller must provide all of the following:

- `--image-lock=unlocked`
- `--image-unlock-current-message-confirmed`
- `--image-unlock-trigger=<verbatim current-message lock-unlock phrase>`
- `--image-execution=allowed`
- `--image-current-message-confirmed`
- `--image-trigger=<verbatim current-message execution phrase>`

Missing, stale, generic, or non-current-message unlock/execution evidence must fail closed. Ordinary execution wording cannot be reused as fake lock-unlock evidence.

Optional `other work` and degraded-mode reason metadata may be recorded when useful, but they are not required card fields.

This file is also part of the authoritative files fetched by the Runtime Execution Gate, so the dedicated first-message contract cannot be removed without breaking regression checks.

## 4. Cloud / Connector path

A cloud assistant that cannot run the local Runtime Execution Gate is not exempt.

Its protocol is:

1. Send the execution card as the first visible message. If the current user message contains or attaches an image/screenshot and this turn will use any tool, include `画像ツールロック解除: YES | NO` and `画像実行判定: YES | NO` in that card even when image execution is not intended.
2. If an image-generation/editing tool is intended, first reset both image decisions to `NO`, then require an explicit current-message ChatGPT image-tool lock-unlock phrase and a separate explicit current-message image execution phrase. Include all four image proof fields in the same card. If either proof cannot be supplied, remove image tools from the candidate set and do not call them.
3. Only then call the minimum read-only lookup needed to resolve latest `main`.
4. Fetch and read the **full current `main` MASTER** from that resolved SHA before any other project-state or project-document read; if truncated, continue range/chunk reads until complete.
5. Only after MASTER reading is complete, re-fetch Preflight, this file, `docs/EVIDENCE-FRESHNESS-GATE.md`, and `docs/IMAGE-EXECUTION-GATE.md`, then gather any PR/workflow/deployment/implementation evidence needed for the task.
6. Do not mutate anything until the MASTER-first bootstrap and the remaining required authoritative-file bootstrap are complete.
7. If the assistant notices that a tool was called before the card, that project-state/project-document reads were performed before the current MASTER was actually read, or that an image tool was called without both valid current-message image proofs, stop mutations/image execution for that turn, report the gate failure, and treat any later card or later proof in the same turn as invalid recovery. A late card cannot repair the ordering violation in the same turn.
8. The next tool-using turn must begin with a fresh card and a fresh latest-main/current-MASTER read. Both image decisions must also reset and be proven again from that new current user message.

The cloud path cannot rely on `I remembered the rule`, `MASTERに書いてある`, a prior-turn read, prior-turn lock unlock, prior-turn image permission, or cached/project-attached copies as evidence. The visible ordering plus current-turn GitHub reads are the source of truth because the connector layer cannot inspect or block the chat UI before its first call.

## 5. Evidence Freshness Gate

Before making a current-state claim about beta readiness, or before entering `deploy`, `vercel`, `supabase`, or `stripe` work, apply `docs/EVIDENCE-FRESHNESS-GATE.md`.

Historical release-evidence files are snapshots. An older `OPEN`, `PENDING`, `NOT YET RECORDED`, or unchecked item must not be treated as current when a later same-scope workflow or Production approval ledger proves success. Conversely, an older `PASS` must be re-evaluated when later relevant changes can invalidate that proof.

Before repeating a Production mutation, the assistant must search for the newest same-purpose successful proof, inspect the decisive workflow job/log and approval ledger when applicable, compare the proof SHA against current `main` for later relevant changes, and classify the evidence as `current`, `refresh-required`, or `unknown`.

- `current`: the same Production mutation is already satisfied and must not be repeated.
- `refresh-required`: explain the invalidating change and continue only inside the currently approved Production scope.
- `unknown`: fail closed and gather better read-only evidence before mutation.

A cloud/Connector assistant must perform this resolution with Connector/API reads. A local/runtime-capable agent must additionally provide the evidence-freshness fields required by the Runtime Gate. A historical evidence document alone is never sufficient to justify a repeated Production operation.

## 6. Regression rule

CI must keep tests that assert:

- AGENTS, Preflight, and Automation Continuation Gate retain the first-visible-message rule;
- this file, `docs/EVIDENCE-FRESHNESS-GATE.md`, and `docs/IMAGE-EXECUTION-GATE.md` remain part of the Runtime Gate authoritative file set;
- every execution card carries workload and the next user-action condition;
- other-work guidance is optional and must not be emitted as a default filler line;
- degraded mode may omit both the time estimate and a user-visible omission explanation;
- timed mode requires a total estimate;
- the cloud path explicitly treats a late card as invalid for that turn;
- the current-turn bootstrap requires latest-main resolution followed by a full current-MASTER read before other project reads;
- a prior-turn MASTER read, cached summary, attachment, existence/SHA check, or partial snippet cannot satisfy the MASTER-read gate;
- image execution requires a current-message image-tool unlock plus a separate current-message YES execution decision and exact quoted phrases before image-tool routing;
- **a screenshot/image-attached NOVELIGHT turn that will use any tool exposes `画像ツールロック解除: YES | NO` and `画像実行判定: YES | NO` in the execution card even when image execution is not intended;**
- **an image/screenshot attachment without both current-message proofs surfaces `画像ツールロック解除: NO` and `画像実行判定: NO`, and quote fields are not fabricated;**
- ordinary execution wording such as `作って`, `編集して`, `修正して`, and `改善して` cannot unlock image tools;
- consultation/approval wording such as `文字をもう少し小さくしたい`, `両側にロゴでも入れる？`, `完璧`, `いいね`, and `これでOK` remains non-execution by itself;
- a new user message invalidates both image permissions;
- the local `image` Runtime Gate phase fails without both explicit current-message image proofs;
- an unauthorized image-tool attempt is a violation even when no image renders;
- deploy/Vercel/Supabase/Stripe phases fail closed without evidence-freshness proof;
- current evidence blocks duplicate external-state mutation.

The purpose is to make a missing execution card, an unread MASTER, an inferred image command, an unproven image-tool unlock, or stale-state assumption a detectable contract violation instead of a style preference, while being explicit about the platform boundary that repository code cannot directly enforce.