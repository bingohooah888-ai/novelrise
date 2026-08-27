import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseExecutionCardEvidence } from '../scripts/runtime-execution-gate.mjs';

const agents = await readFile('AGENTS.md', 'utf8');
const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');
const continuation = await readFile(
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  'utf8'
);
const contract = await readFile('docs/EXECUTION-TURN-CARD-GATE.md', 'utf8');
const runtimeGate = await readFile(
  'scripts/runtime-execution-gate.mjs',
  'utf8'
);

function validTimedArgs() {
  return [
    '--card-visible',
    '--card-total=20-30m',
    '--card-steps=a,b,c',
    '--card-manual=0',
    '--card-wait=none',
    '--card-workload=medium',
    '--card-other-work=allowed',
    '--card-next-user-action=none'
  ];
}

function validDegradedArgs() {
  return [
    '--card-visible',
    '--card-mode=degraded',
    '--card-steps=a,b,c',
    '--card-manual=0',
    '--card-wait=none',
    '--card-workload=medium',
    '--card-other-work=allowed',
    '--card-next-user-action=none',
    '--card-reason=higher-level execution constraint'
  ];
}

test('all execution governance layers retain the first-visible-message rule', () => {
  for (const text of [agents, preflight, continuation]) {
    assert.match(text, /最初のユーザー可視メッセージ/);
    assert.match(text, /カード送信前.*ツール呼び出し.*禁止/s);
  }

  assert.match(contract, /Zero-tool rule/);
  assert.match(contract, /first visible message/i);
  assert.match(
    contract,
    /Adding the degraded explanation later in the turn is also invalid/
  );
  assert.match(contract, /late card as invalid for that turn/);
});

test('every execution card carries practical scheduling guidance', () => {
  assert.match(contract, /`作業量`/);
  assert.match(contract, /`別作業`/);
  assert.match(contract, /`次のユーザー操作`/);
  assert.match(contract, /具体的な所要時間：実行環境の制約により表示できません。/);

  const requiredOptions = [
    ['--card-workload=', /must include qualitative workload/],
    ['--card-other-work=', /must state whether other work is safe/],
    ['--card-next-user-action=', /must include the next user-action condition/]
  ];

  for (const [prefix, errorPattern] of requiredOptions) {
    assert.throws(
      () =>
        parseExecutionCardEvidence(
          validTimedArgs().filter((arg) => !arg.startsWith(prefix)),
          {}
        ),
      errorPattern
    );
  }

  const evidence = parseExecutionCardEvidence(validTimedArgs(), {});
  assert.equal(evidence.workload, 'medium');
  assert.equal(evidence.otherWork, 'allowed');
  assert.equal(evidence.nextUserAction, 'none');
});

test('degraded mode can never omit the time-omission explanation', () => {
  assert.match(
    contract,
    /具体的な所要時間：実行環境の制約により表示できません。/
  );

  assert.throws(
    () =>
      parseExecutionCardEvidence(
        validDegradedArgs().filter((arg) => !arg.startsWith('--card-reason=')),
        {}
      ),
    /must include the omission reason/
  );

  const evidence = parseExecutionCardEvidence(validDegradedArgs(), {});
  assert.equal(evidence.mode, 'degraded');
  assert.equal(evidence.total, '');
  assert.equal(evidence.reason, 'higher-level execution constraint');
  assert.equal(evidence.workload, 'medium');
  assert.equal(evidence.otherWork, 'allowed');
  assert.equal(evidence.nextUserAction, 'none');
});

test('timed mode still requires total estimated time', () => {
  const evidence = parseExecutionCardEvidence(validTimedArgs(), {});
  assert.equal(evidence.mode, 'timed');
  assert.equal(evidence.total, '20-30m');

  assert.throws(
    () =>
      parseExecutionCardEvidence(
        validTimedArgs().filter((arg) => !arg.startsWith('--card-total=')),
        {}
      ),
    /must include total estimated time/
  );
});

test('runtime gate treats the dedicated execution-card contract as authoritative', () => {
  assert.match(runtimeGate, /docs\/EXECUTION-TURN-CARD-GATE\.md/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_WORKLOAD/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_OTHER_WORK/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_NEXT_USER_ACTION/);
  assert.match(runtimeGate, /version: 4/);
});