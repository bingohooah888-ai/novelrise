import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseEvidenceFreshnessEvidence,
  parseExecutionCardEvidence
} from '../scripts/runtime-execution-gate.mjs';

const agents = await readFile('AGENTS.md', 'utf8');
const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');
const continuation = await readFile(
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  'utf8'
);
const contract = await readFile('docs/EXECUTION-TURN-CARD-GATE.md', 'utf8');
const evidenceFreshnessContract = await readFile(
  'docs/EVIDENCE-FRESHNESS-GATE.md',
  'utf8'
);
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
    '--card-next-user-action=none'
  ];
}

function validFreshnessArgs(verdict = 'refresh-required') {
  return [
    '--evidence-freshness-checked',
    '--evidence-duplicate-check',
    '--evidence-source=workflow-run:33065836764+approval-ledger:165+compare:proof-to-main',
    '--evidence-observed-at=2026-08-28T00:00:00+09:00',
    `--evidence-verdict=${verdict}`,
    '--evidence-proof-sha=944c2232a577ebeae32798c29a508b8540a26807'
  ];
}

test('all execution governance layers retain the first-visible-message rule', () => {
  for (const text of [agents, preflight, continuation]) {
    assert.match(text, /最初のユーザー可視メッセージ/);
    assert.match(text, /カード送信前.*ツール呼び出し.*禁止/s);
  }

  assert.match(contract, /Zero-tool rule/);
  assert.match(contract, /first visible message/i);
  assert.match(contract, /omit time information from the user-visible card/);
  assert.match(contract, /late card as invalid for that turn/);
});

test('execution cards keep only decision-useful required guidance', () => {
  assert.match(contract, /`作業量`/);
  assert.match(contract, /`別作業` is optional/);
  assert.match(contract, /`次のユーザー操作`/);
  assert.doesNotMatch(
    contract,
    /具体的な所要時間：実行環境の制約により表示できません。/
  );

  const requiredOptions = [
    ['--card-workload=', /must include qualitative workload/],
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
  assert.equal(evidence.otherWork, '');
  assert.equal(evidence.nextUserAction, 'none');
});

test('degraded mode omits fixed time-unavailable filler', () => {
  assert.doesNotMatch(
    contract,
    /具体的な所要時間：実行環境の制約により表示できません。/
  );

  const evidence = parseExecutionCardEvidence(validDegradedArgs(), {});
  assert.equal(evidence.mode, 'degraded');
  assert.equal(evidence.total, '');
  assert.equal(evidence.reason, '');
  assert.equal(evidence.workload, 'medium');
  assert.equal(evidence.otherWork, '');
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

test('external-state phases require explicit evidence freshness proof', () => {
  for (const phase of ['deploy', 'vercel', 'supabase', 'stripe']) {
    assert.throws(
      () => parseEvidenceFreshnessEvidence(phase, [], {}),
      /requires an Evidence Freshness Gate check/
    );

    const evidence = parseEvidenceFreshnessEvidence(
      phase,
      validFreshnessArgs(),
      {}
    );
    assert.equal(evidence.required, true);
    assert.equal(evidence.checked, true);
    assert.equal(evidence.duplicateCheck, true);
    assert.equal(evidence.verdict, 'refresh-required');
  }
});

test('evidence freshness rejects historical-only or unknown evidence', () => {
  assert.throws(
    () =>
      parseEvidenceFreshnessEvidence(
        'stripe',
        [
          '--evidence-freshness-checked',
          '--evidence-duplicate-check',
          '--evidence-source=release-evidence:2026-08-26',
          '--evidence-observed-at=2026-08-28T00:00:00+09:00',
          '--evidence-verdict=refresh-required'
        ],
        {}
      ),
    /must identify execution\/current-state evidence/
  );

  assert.throws(
    () =>
      parseEvidenceFreshnessEvidence(
        'stripe',
        validFreshnessArgs().map((arg) =>
          arg.startsWith('--evidence-verdict=')
            ? '--evidence-verdict=unknown'
            : arg
        ),
        {}
      ),
    /must be current or refresh-required/
  );
});

test('current evidence blocks duplicate external-state mutation', () => {
  assert.throws(
    () =>
      parseEvidenceFreshnessEvidence(
        'stripe',
        [...validFreshnessArgs('current'), '--mutation-planned'],
        {}
      ),
    /Duplicate external-state mutation blocked/
  );

  const readOnlyEvidence = parseEvidenceFreshnessEvidence(
    'stripe',
    validFreshnessArgs('current'),
    {}
  );
  assert.equal(readOnlyEvidence.verdict, 'current');
  assert.equal(readOnlyEvidence.mutationPlanned, false);
});

test('refresh-required evidence can pass freshness without bypassing approvals', () => {
  const evidence = parseEvidenceFreshnessEvidence(
    'stripe',
    [...validFreshnessArgs('refresh-required'), '--mutation-planned'],
    {}
  );
  assert.equal(evidence.verdict, 'refresh-required');
  assert.equal(evidence.mutationPlanned, true);

  assert.match(
    evidenceFreshnessContract,
    /continue only within the currently approved Production scope/
  );
});

test('non external-state phases do not require freshness fields', () => {
  const evidence = parseEvidenceFreshnessEvidence('implementation', [], {});
  assert.equal(evidence.required, false);
});

test('freshness contract prevents stale release snapshots from winning', () => {
  assert.match(evidenceFreshnessContract, /Historical documents are snapshots/);
  assert.match(
    evidenceFreshnessContract,
    /older `OPEN`.*must not override a later successful workflow/s
  );
  assert.match(
    evidenceFreshnessContract,
    /Duplicate Production mutation block/
  );
  assert.match(
    evidenceFreshnessContract,
    /A historical evidence document alone is never sufficient/
  );
  assert.match(contract, /Evidence Freshness Gate/);
  assert.match(contract, /same-purpose successful proof/);
});

test('runtime gate treats execution and freshness contracts as authoritative', () => {
  assert.match(runtimeGate, /docs\/EXECUTION-TURN-CARD-GATE\.md/);
  assert.match(runtimeGate, /docs\/EVIDENCE-FRESHNESS-GATE\.md/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_WORKLOAD/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_OTHER_WORK/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_NEXT_USER_ACTION/);
  assert.match(runtimeGate, /NOVELIGHT_EVIDENCE_FRESHNESS_CHECKED/);
  assert.match(runtimeGate, /NOVELIGHT_EVIDENCE_DUPLICATE_CHECK/);
  assert.match(runtimeGate, /NOVELIGHT_MUTATION_PLANNED/);
  assert.match(runtimeGate, /version: 6/);
});
