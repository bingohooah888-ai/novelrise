import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseExecutionCardEvidence } from '../scripts/runtime-execution-gate.mjs';

const contract = await readFile('docs/EXECUTION-TURN-CARD-GATE.md', 'utf8');
const runtimeGate = await readFile('scripts/runtime-execution-gate.mjs', 'utf8');

function validTimedArgs() {
  return [
    '--card-visible',
    '--card-first-message',
    '--card-mode=timed',
    '--card-turn-id=turn-20260827-001',
    '--card-total=20-30m',
    '--card-steps=a,b,c',
    '--card-manual=0',
    '--card-wait=none'
  ];
}

test('execution-card contract keeps zero-tool and degraded-time wording explicit', () => {
  assert.match(contract, /Zero-tool rule/);
  assert.match(contract, /first user-visible message/i);
  assert.match(contract, /時間見積もり：実行環境の上位制約により省略。/);
  assert.match(contract, /Adding the degraded explanation later in the turn is also invalid/);
  assert.match(runtimeGate, /docs\/EXECUTION-TURN-CARD-GATE\.md/);
});

test('runtime gate accepts a complete timed card only with first-message evidence', () => {
  const evidence = parseExecutionCardEvidence(validTimedArgs(), {});
  assert.equal(evidence.visible, true);
  assert.equal(evidence.firstMessage, true);
  assert.equal(evidence.mode, 'timed');
  assert.equal(evidence.turnId, 'turn-20260827-001');
  assert.equal(evidence.total, '20-30m');
});

test('runtime gate does not default card mode', () => {
  const args = validTimedArgs().filter((arg) => !arg.startsWith('--card-mode='));
  assert.throws(
    () => parseExecutionCardEvidence(args, {}),
    /mode must be explicitly set to timed or degraded/
  );
});

test('runtime gate rejects cards that were not the first visible message', () => {
  const args = validTimedArgs().filter((arg) => arg !== '--card-first-message');
  assert.throws(
    () => parseExecutionCardEvidence(args, {}),
    /must be the first user-visible message/
  );
});

test('runtime gate requires a fresh turn ID', () => {
  const args = validTimedArgs().filter(
    (arg) => !arg.startsWith('--card-turn-id=')
  );
  assert.throws(
    () => parseExecutionCardEvidence(args, {}),
    /fresh execution-turn ID/
  );
});

test('degraded mode requires an explicit omission reason', () => {
  const args = validTimedArgs()
    .filter(
      (arg) =>
        !arg.startsWith('--card-mode=') && !arg.startsWith('--card-total=')
    )
    .concat('--card-mode=degraded');

  assert.throws(
    () => parseExecutionCardEvidence(args, {}),
    /must include the omission reason/
  );

  const evidence = parseExecutionCardEvidence(
    args.concat('--card-reason=higher-level execution constraint'),
    {}
  );
  assert.equal(evidence.mode, 'degraded');
  assert.equal(evidence.total, '');
  assert.equal(evidence.reason, 'higher-level execution constraint');
});

test('timed mode still requires a total estimate', () => {
  const args = validTimedArgs().filter((arg) => !arg.startsWith('--card-total='));
  assert.throws(
    () => parseExecutionCardEvidence(args, {}),
    /must include total estimated time/
  );
});
