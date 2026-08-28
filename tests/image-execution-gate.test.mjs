import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as runtime from '../scripts/runtime-execution-gate.mjs';

const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');
const contract = await readFile('docs/IMAGE-EXECUTION-GATE.md', 'utf8');
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

test('image contract requires a current-message binary decision before routing', () => {
  assertIncludesAll(contract, [
    'CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = YES | NO',
    'The default is always `NO` on every new user message.',
    'If the exact authorizing phrase cannot be quoted from the current user message, the decision is `NO`.',
    'The binary decision happens before generic tool routing.',
    'image-generation and image-editing tools must be removed from the candidate tool set',
    'they must be placed in `denied_tools` for the turn',
    'they must not appear in `allowed_tools`'
  ]);
});

test('banner consultation examples remain non-executable', () => {
  assert.match(preflight, /画像生成/u);
  assertIncludesAll(contract, [
    '文字をもう少し小さくしたい',
    '両側にロゴでも入れる？',
    '`〜したい`',
    '`〜入れる？`',
    'must not be silently rewritten into `〜して` or `作って`'
  ]);
});

test('image permission expires and a tool attempt counts as execution', () => {
  assertIncludesAll(contract, [
    'A new user message always resets:',
    'CURRENT_MESSAGE_EXPLICIT_IMAGE_EXECUTION = NO',
    'Calling an image-generation or image-editing tool counts as image execution',
    'no image is ultimately rendered',
    'stop further image execution in that turn'
  ]);
});

test('image phase fails closed without current-message evidence', () => {
  assert.equal(runtime.parsePhase(['--phase=image']), 'image');
  assert.throws(
    () => parseImage([]),
    /requires explicit allowed image-execution evidence/u
  );

  assert.throws(
    () => parseImage(['--image-execution=allowed']),
    /requires confirmation that the evidence comes from the current user message/u
  );

  assert.throws(
    () =>
      parseImage([
        '--image-execution=allowed',
        '--image-current-message-confirmed'
      ]),
    /requires a verbatim current-message execution trigger/u
  );

  assert.throws(
    () =>
      parseImage([
        '--image-execution=allowed',
        '--image-current-message-confirmed',
        '--image-trigger=続けて'
      ]),
    /cannot be a continuation-only acknowledgement/u
  );
});

test('image phase accepts explicit current-message evidence', () => {
  const evidence = parseImage([
    '--image-execution=allowed',
    '--image-current-message-confirmed',
    '--image-trigger=この画像を編集して'
  ]);

  assert.deepEqual(evidence, {
    required: true,
    decision: 'allowed',
    currentMessageConfirmed: true,
    trigger: 'この画像を編集して'
  });
});

test('non-image phases do not require image evidence', () => {
  const evidence = runtime.parseImageExecutionEvidence('implementation', [], {});
  assert.deepEqual(evidence, {
    required: false,
    decision: '',
    currentMessageConfirmed: false,
    trigger: ''
  });
});

test('runtime gate loads the dedicated image contract', () => {
  assert.match(runtimeGate, /docs\/IMAGE-EXECUTION-GATE\.md/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_EXECUTION/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_CURRENT_MESSAGE_CONFIRMED/);
  assert.match(runtimeGate, /NOVELIGHT_IMAGE_TRIGGER/);
  assert.match(runtimeGate, /version: 7/);
});
