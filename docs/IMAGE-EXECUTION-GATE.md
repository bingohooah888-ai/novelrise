# NOVELIGHT IMAGE EXECUTION GATE

This file is the fail-closed contract for any NOVELIGHT image-generation or image-editing tool call.

`docs/NOVELIGHT-MASTER.md` remains the highest project authority. This contract strengthens the image-specific execution rule already defined in `docs/WORK-EXECUTION-PREFLIGHT.md` and does not relax any stronger Noctar/ComfyUI lock.

## 1. Project-wide ChatGPT image-tool hard lock

ChatGPT-side image-generation and image-editing tools are **LOCKED by default for every NOVELIGHT user message**.

Before an image tool is even considered as a candidate, make two independent current-message decisions:

`CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = YES | NO`

`CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = YES | NO`

The default is always `NO` for both decisions on every new user message.

An image tool may be considered only when **both decisions are `YES` from the same current user message**.

Set `CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = YES` only when the current user message itself explicitly and directly states that the ChatGPT-side image-generation/editing lock should be解除/unlocked/re-enabled, and the assistant can quote that exact current-message phrase.

Set `CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = YES` only when the same current user message itself contains an unambiguous instruction to actually generate, draw, create, edit, modify, fix, composite, or otherwise execute image work, and the assistant can quote that exact current-message phrase.

A normal image execution instruction is **not** a lock-unlock instruction. For example, `作って`, `生成して`, `編集して`, `修正して`, and `改善して` can describe requested image work, but by themselves they do not unlock ChatGPT-side image tools.

Do not infer either `YES` from prior turns, attached images, screenshots, surrounding design discussion, likely user intent, assistant convenience, or generic tool-routing preferences.

If either exact authorizing phrase cannot be quoted from the current user message, the corresponding decision remains `NO` and ChatGPT-side image tools remain denied.

## 2. Consultation, approval, and desired-state language are not execution or unlock

A statement about a desired visual state, an evaluation of a result, or approval of a completed image is not automatically an instruction to perform another edit.

The following examples remain non-executable and do not unlock image tools by themselves:

- `文字をもう少し小さくしたい`
- `両側にロゴでも入れる？`
- `こうしたらどう？`
- `直した方がいい？`
- `どっちがいい？`
- `この画像どう？`
- `作れる？`
- `完璧`
- `いいね`
- `これでOK`
- `はい`
- `続けて`
- an image or screenshot attached without both explicit current-message proofs

In particular, Japanese forms such as `〜したい`, `〜入れる？`, `〜した方がいい？`, and other consultation, preference, proposal, feasibility, approval, or reaction language must not be silently rewritten into `〜して`, `作って`, or a lock-unlock command.

If the same current message contains an explicit execution instruction but no explicit lock-unlock instruction, execution remains prohibited.

## 3. Pre-routing deny rule

Both binary decisions happen before generic tool routing.

When either `CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = NO` or `CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO`:

- image-generation and image-editing tools must be removed from the candidate tool set;
- they must be placed in `denied_tools` for the turn;
- they must not appear in `allowed_tools`;
- no automatic router, image attachment, default image-edit preference, efficiency argument, or assistant initiative may add them back;
- respond with text-only consultation, analysis, acknowledgement, or clarification as appropriate.

This is a pre-routing hard lock, not a post-hoc reminder.

When both decisions are `YES`, only the explicitly requested image scope is eligible. Additional variants, edits, or generations are not implicitly authorized.

## 4. Both permissions expire on every user message

Image-tool unlock and image execution permission are current-message-only.

A new user message always resets:

`CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = NO`

`CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO`

A prior `画像ツールのロックを解除して`, `作って`, `生成して`, `編集して`, or similar instruction cannot be carried forward. `はい`, `続けて`, a screenshot, a result review, approval such as `完璧`, or a new design question does not inherit either permission.

The user must supply both current-message proofs again for every later image-tool call turn.

## 5. User-visible execution-card proof

If a NOVELIGHT assistant turn intends to call an image-generation or image-editing tool, the current-turn execution card must be sent before the tool call and must additionally contain all four fields:

- `画像ツールロック解除: YES`
- `ロック解除命令引用: <current user messageからの原文引用>`
- `画像実行判定: YES`
- `明示命令引用: <current user messageからの原文引用>`

If any field cannot truthfully be supplied from the current user message, the image tool call is prohibited.

The unlock quote and execution quote may be separate phrases inside the same current user message. A generic execution phrase must not be reused as fake unlock evidence.

This conditional image proof is in addition to the ordinary execution-card fields and does not replace them.

## 6. Tool-call attempt itself is execution

Calling an image-generation or image-editing tool counts as image execution for this gate even when:

- no image is ultimately rendered;
- the tool returns an error;
- the output is discarded;
- the assistant later answers only in text.

Therefore a prohibited tool call cannot be treated as harmless merely because no visible image appeared.

If an unauthorized image-tool call is detected, stop further image execution in that turn, report the gate failure, and require a fresh current-message unlock plus execution decision on the next user turn.

## 7. Stronger individual locks win

A project-wide unlock plus explicit execution instruction does not override a stronger project-specific lock.

In particular, the current Noctar/ComfyUI lock remains authoritative. ChatGPT-side image generation or editing for Noctar remains prohibited unless that stronger lock is separately and explicitly changed according to its own contract.

## 8. Local/runtime enforcement

For local/runtime-capable image execution, use the Runtime Execution Gate `image` phase.

The image phase must receive all of the following current-message evidence:

- `--image-lock=unlocked`
- `--image-unlock-current-message-confirmed`
- `--image-unlock-trigger=<verbatim current-message lock-unlock phrase>`
- `--image-execution=allowed`
- `--image-current-message-confirmed`
- `--image-trigger=<verbatim current-message execution phrase>`

Equivalent environment variables are:

- `NOVELIGHT_IMAGE_LOCK`
- `NOVELIGHT_IMAGE_UNLOCK_CURRENT_MESSAGE_CONFIRMED`
- `NOVELIGHT_IMAGE_UNLOCK_TRIGGER`
- `NOVELIGHT_IMAGE_EXECUTION`
- `NOVELIGHT_IMAGE_CURRENT_MESSAGE_CONFIRMED`
- `NOVELIGHT_IMAGE_TRIGGER`

Missing, denied, locked, stale, continuation-only, or non-current-message evidence must fail closed before image execution.

The unlock trigger must explicitly describe unlocking/re-enabling ChatGPT-side image generation/editing. Ordinary execution-only wording such as `作って`, `編集して`, `修正して`, or `改善して` must not satisfy the unlock field.

The runtime evidence is an auditable assertion; it cannot mechanically inspect the full chat transcript. Cloud assistants therefore remain responsible for the pre-routing decision and visible exact-quote proofs above.

## 9. Cloud / connector enforcement

A cloud assistant that cannot run the local Runtime Gate is not exempt.

Before an image tool call it must:

1. Reset both image decisions to `NO` for the new user message.
2. Find and quote an explicit current-message ChatGPT image-tool unlock phrase.
3. Find and quote an explicit current-message image execution phrase.
4. Send the ordinary current-turn Execution Card plus all four image proof fields.
5. Only then allow the image tool into the candidate set.

If either proof is missing, the turn remains text-only for image-related discussion. A previous-turn unlock, a previous-turn execution command, a screenshot, an approval reaction, or automatic routing can never substitute for the current-message proofs.

## 10. Regression requirement

CI must retain tests proving that:

- the dedicated image contract remains part of the Runtime Gate authoritative-file set;
- the Runtime Gate supports an `image` phase and rejects it without explicit current-message lock-unlock evidence;
- explicit image execution without a separate lock unlock fails closed;
- an image phase cannot pass without verbatim unlock and execution trigger strings;
- ordinary execution wording such as `作って`, `編集して`, `修正して`, and `改善して` cannot satisfy the unlock trigger;
- the project contracts explicitly classify `文字をもう少し小さくしたい`, `両側にロゴでも入れる？`, `完璧`, `いいね`, and `これでOK` as non-execution examples;
- either `NO` decision removes image tools before generic routing;
- both permissions reset on every new user message;
- the user-visible execution card requires both unlock and execution proof before image-tool routing;
- an attempted prohibited image-tool call is itself a gate violation even if no image renders.

The purpose is to prevent consultation, approval, continuation, or ordinary editing language from being converted into ChatGPT-side image execution by inference, automatic routing, context carry-over, or convenience.