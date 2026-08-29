import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as runtime from '../scripts/runtime-execution-gate.mjs';

const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');
const contract = await readFile('docs/IMAGE-EXECUTION-GATE.md', 'utf8');
const executionCardContract = await readFile(
  'docs/EXECUTION-TURN-CARD-GATE.md',
  'utf8'
);
const runtimeGate = await readFile(
  'scripts/runtime-execution-gate.mjs',
  'utf8'
);

function assertIncludesAll(source, tokens) {
  for (const token of tokens) {
    assert.equal(source.includes(token), true, token);
  }
}

function parseImage(args) {
  return runtime.parseImageExecutionEvidence('image', args, {});
}

function validUnlockArgs() {
  return [
    '--image-lock=unlocked',
    '--image-unlock-current-message-confirmed',
    '--image-unlock-trigger=ChatGPTの画像ツールのロックを解除して'
  ];
}

function validExecutionArgs() {
  return [
    '--image-execution=allowed',
    '--image-current-message-confirmed',
    '--image-trigger=この画像を編集して'
  ];
}

test('image decisions happen before tool routing with a default hard lock', () => {
  assertIncludesAll(contract, [
    'CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = YES | NO',
    'CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = YES | NO',
    'The default is always `NO` for both decisions on every new user message.',
    'The binary decisions happen before generic tool routing.',
    'image-generation and image-editing tools must be removed from the candidate tool set',
    'they must be placed in `denied_tools` for the turn',
    'they must not appear in `allowed_tools`'
  ]);
});

test('consultation and approval examples remain non-executable', () => {
  assert.match(preflight, /画像生成/u);
  assertIncludesAll(contract, [
    '文字をもう少し小さくしたい',
    '両側にロゴでも入れる？',
    '完璧',
    'いいね',
    'これでOK',
    '`〜したい`',
    '`〜入れる？`',
    'must not be silently rewritten into `〜して`, `作って`, or a lock-unlock command'
  ]);
});

test('ordinary image execution wording does not unlock image tools', () => {
  assertIncludesAll(contract, [
    '`作って`',
    '`生成して`',
    '`編集して`',
    '`修正して`',
    '`改善して`',
    'by themselves they do not unlock ChatGPT-side image tools'
  ]);

  for (const trigger of ['作って', '編集して', '修正して', '改善して']) {
    assert.throws(
      () =>
        parseImage([
          '--image-lock=unlocked',
          '--image-unlock-current-message-confirmed',
          `--image-unlock-trigger=${trigger}`
        ]),
      /must explicitly describe unlocking or re-enabling the image-tool lock/u
    );
  }
});

test('both image permissions expire and a tool attempt counts as execution', () => {
  assertIncludesAll(contract, [
    'A new user message always resets:',
    'CURRENT_MESSAGE_IMAGE_TOOL_UNLOCK = NO',
    'CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO',
    'Calling an image-generation or image-editing tool counts as image execution',
    'no image is ultimately rendered',
    'stop further image execution in that turn'
  ]);
});

test('image phase fails closed without current-message lock-unlock evidence', () => {
  assert.equal(runtime.parsePhase(['--phase=image']), 'image');
  assert.throws(
    () => parseImage([]),
    /requires an explicit ChatGPT image-tool lock unlock/u
  );

  assert.throws(
    () => parseImage(['--image-lock=unlocked']),
    /requires confirmation that the lock-unlock evidence comes from the current user message/u
  );

  assert.throws(
    () =>
      parseImage([
        '--image-lock=unlocked',
        '--image-unlock-current-message-confirmed'
      ]),
    /requires a verbatim current-message image-tool lock-unlock trigger/u
  );
});

test('explicit image execution without separate unlock fails closed', () => {
  assert.throws(
    () => parseImage(validExecutionArgs()),
    /requires an explicit ChatGPT image-tool lock unlock/u
  );
});

test('image phase still requires current-message execution evidence after unlock', () => {
  assert.throws(
    () => parseImage(validUnlockArgs()),
    /requires explicit allowed image-execution evidence/u
  );

  assert.throws(
    () => parseImage([...validUnlockArgs(), '--image-execution=allowed']),
    /requires confirmation that the execution evidence comes from the current user message/u
  );

  assert.throws(
    () =>
      parseImage([
        ...validUnlockArgs(),
        '--image-execution=allowed',
        '--image-current-message-confirmed'
      ]),
    /requires a verbatim current-message execution trigger/u
  );

  assert.throws(
    () =>
      parseImage([
        ...validUnlockArgs(),
        '--image-execution=allowed',
        '--image-current-message-confirmed',
        '--image-trigger=完璧'
      ]),
    /cannot be a continuation-only acknowledgement or approval reaction/u
  );
});

test('image phase accepts separate explicit unlock and execution evidence', () => {
  const evidence = parseImage([...validUnlockArgs(), ...validExecutionArgs()]);

  assert.deepEqual(evidence, {
    required: true,
    lock: 'unlocked',
    unlockCurrentMessageConfirmed: true,
    unlockTrigger: 'ChatGPTの画像ツールのロックを解除して',
    decision: 'allowed',
    currentMessageConfirmed: true,
    trigger: 'この画像を編集して'
  });
});

test('non-image phases do not require image evidence', () => {
  const evidence = runtime.parseImageExecutionEvidence(
    'implementation',
    [],
    {}
  );
  assert.deepEqual(evidence, {
    required: false,
    lock: '',
    unlockCurrentMessageConfirmed: false,
    unlockTrigger: '',
    decision: '',
    currentMessageConfirmed: false,
    trigger: ''
  });
});

test('execution card contract requires both image proofs', () => {
  assertIncludesAll(executionCardContract, [
    '画像ツールロック解除: YES',
    'ロック解除命令引用:',
    '画像実行判定: YES',
    '明示命令引用:'
  ]);
});

test('visual-input tool turns must expose image decisions even when image execution is not intended', () => {
  assertIncludesAll(executionCardContract, [
    'Visual-input image-decision visibility: mandatory deny-state proof',
    'contains or attaches an image or screenshot and the assistant turn will use any tool',
    '`画像ツールロック解除: YES | NO`',
    '`画像実行判定: YES | NO`',
    'even when the turn does not intend to call an image-generation or image-editing tool',
    '`画像ツールロック解除: NO`',
    '`画像実行判定: NO`',
    'must not invent a supporting quote'
  ]);

  assertIncludesAll(contract, [
    'Visual-input tool turns must expose NO/YES decisions even without image execution',
    'contains or attaches an image or screenshot',
    '`画像ツールロック解除: YES | NO`',
    '`画像実行判定: YES | NO`',
    'An image or screenshot attachment alone',
    '`画像ツールロック解除: NO`',
    '`画像実行判定: NO`',
    'Do not fabricate authorizing quotes for a `NO` decision.'
  ]);
});

test('runtime gate loads and enforces the dedicated image contract', () => {
  assert.match(runtimeGate, /docs\/IMAGE-EXECUTION-GATE\.md/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_LOCK/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_UNLOCK_CURRENT_MESSAGE_CONFIRMED/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_UNLOCK_TRIGGER/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_EXECUTION/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_CURRENT_MESSAGE_CONFIRMED/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_TRIGGER/);
  assert.match(runtimeGate, /version: 8/);
});