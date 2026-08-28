# NOVELIGHT IMAGE EXECUTION GATE

This file is the fail-closed contract for any NOVELIGHT image-generation or image-editing tool call.

`docs/NOVELIGHT-MASTER.md` remains the highest project authority. This contract strengthens the image-specific execution rule already defined in `docs/WORK-EXECUTION-PREFLIGHT.md` and does not relax any stronger Noctar/ComfyUI lock.

## 1. Current-message-only binary decision

Before image generation or image editing is even considered as a tool candidate, set exactly one internal decision for the current user message:

`CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = YES | NO`

The default is always `NO` on every new user message.

Set it to `YES` only when the current user message itself contains an unambiguous instruction to actually generate, draw, create, edit, modify, fix, composite, or otherwise execute image work, and the assistant can quote the exact current-message phrase that authorizes that execution.

Do not infer `YES` from prior turns, attached images, screenshots, the surrounding design discussion, likely user intent, assistant convenience, or a generic image-tool preference.

If the exact authorizing phrase cannot be quoted from the current user message, the decision is `NO`.

## 2. Consultation and desired-state language are not execution

A statement about a desired visual state is not automatically an instruction to perform the edit.

The following examples remain `NO` by themselves:

- `文字をもう少し小さくしたい`
- `両側にロゴでも入れる？`
- `こうしたらどう？`
- `直した方がいい？`
- `どっちがいい？`
- `この画像どう？`
- `作れる？`
- an image or screenshot attached without an explicit execution instruction

In particular, Japanese forms such as `〜したい`, `〜入れる？`, `〜した方がいい？`, and other consultation, preference, proposal, or feasibility language must not be silently rewritten into `〜して` or `作って`.

If the same current message also contains an explicit execution instruction, quote that actual execution phrase and evaluate that phrase rather than relying on the desired-state wording.

## 3. Pre-routing deny rule

The binary decision happens before generic tool routing.

When `CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO`:

- image-generation and image-editing tools must be removed from the candidate tool set;
- they must be placed in `denied_tools` for the turn;
- they must not appear in `allowed_tools`;
- no automatic router, image attachment, default image-edit preference, efficiency argument, or assistant initiative may add them back;
- respond with text-only consultation, analysis, or clarification as appropriate.

This is a pre-routing gate, not a post-hoc reminder.

When `CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = YES`, only the explicitly requested image scope is eligible. Additional variants, edits, or generations are not implicitly authorized.

## 4. Permission expires every user message

Image execution permission is current-message-only.

A new user message always resets:

`CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO`

A prior `作って`, `生成して`, `編集して`, or similar instruction cannot be carried forward. `はい`, `続けて`, a screenshot, a result review, or a new design question does not inherit the prior permission.

## 5. User-visible execution-card proof

If an NOVELIGHT assistant turn intends to call an image-generation or image-editing tool, the current-turn execution card must be sent before the tool call and must additionally include:

- `画像実行判定: YES`
- `明示命令引用: <current user messageからの原文引用>`

If either field cannot truthfully be supplied, the image tool call is prohibited.

This conditional image proof is in addition to the ordinary execution-card fields and does not replace them.

## 6. Tool-call attempt itself is execution

Calling an image-generation or image-editing tool counts as image execution for this gate even when:

- no image is ultimately rendered;
- the tool returns an error;
- the output is discarded;
- the assistant later answers only in text.

Therefore a prohibited tool call cannot be treated as harmless merely because no visible image appeared.

If an unauthorized image-tool call is detected, stop further image execution in that turn, report the gate failure, and require a fresh current-message decision on the next user turn.

## 7. Stronger individual locks win

A `YES` decision under this general gate does not override a stronger project-specific lock.

In particular, the current Noctar/ComfyUI lock remains authoritative: general wording such as `作って` does not by itself authorize ChatGPT-side image generation or editing for Noctar when a stronger lock forbids that tool/environment.

## 8. Local/runtime enforcement

For local/runtime-capable image execution, use the Runtime Execution Gate `image` phase.

The image phase must receive all of the following evidence:

- `--image-execution=allowed`
- `--image-current-message-confirmed`
- `--image-trigger=<verbatim current-message execution phrase>`

Equivalent `NOVELIGHT_IMAGE_EXECUTION`, `NOVELIGHT_IMAGE_CURRENT_MESSAGE_CONFIRMED`, and `NOVELIGHT_IMAGE_TRIGGER` environment variables may be used.

Missing, denied, stale, or non-current-message evidence must fail closed before image execution.

The runtime evidence is an auditable assertion; it cannot mechanically inspect the chat transcript. Cloud assistants therefore remain responsible for the pre-routing decision and visible exact-quote proof above.

## 9. Regression requirement

CI must retain tests proving that:

- the dedicated image contract remains part of the Runtime Gate authoritative-file set;
- the Runtime Gate supports an `image` phase and rejects it without explicit current-message image evidence;
- an image phase cannot pass without a verbatim trigger string;
- the project contracts explicitly classify `文字をもう少し小さくしたい` and `両側にロゴでも入れる？` as non-execution examples;
- `NO` removes image tools before generic routing;
- permission resets on every new user message;
- an attempted prohibited image-tool call is itself a gate violation even if no image renders.

The purpose is to prevent consultation language from being converted into image execution by inference, automatic routing, or convenience.