import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseCurrentStateBeforeRemediationEvidence
} from '../scripts/runtime-gate-entry.mjs';

const evidenceContract = await readFile(
  'docs/EVIDENCE-FRESHNESS-GATE.md',
  'utf8'
);
const automationContract = await readFile(
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  'utf8'
);
const wrapper = await readFile('scripts/runtime-gate-entry.mjs', 'utf8');

function remediationArgs(verdict = 'refresh-required') {
  return [
    '--remediation-planned',
    '--current-state-checked',
    '--current-state-source=current-state:supabase-migration-history',
    `--evidence-verdict=${verdict}`
  ];
}

function mutationArgs(verdict = 'refresh-required') {
  return [
    '--mutation-planned',
    '--current-state-checked',
    '--current-state-source=remote:database-state',
    `--evidence-verdict=${verdict}`
  ];
}

test(
  'read-only and non-external work does not invent a remediation requirement',
  () => {
    const readOnly = parseCurrentStateBeforeRemediationEvidence(
      'supabase',
      [],
      {}
    );
    assert.equal(readOnly.required, false);

    const implementation = parseCurrentStateBeforeRemediationEvidence(
      'implementation',
      ['--remediation-planned'],
      {}
    );
    assert.equal(implementation.required, false);
  }
);

test('external remediation fails before a fresh current-state observation', () => {
  assert.throws(
    () =>
      parseCurrentStateBeforeRemediationEvidence(
        'supabase',
        ['--remediation-planned', '--evidence-verdict=refresh-required'],
        {}
      ),
    /fresh read-only current-state check/
  );
});

test('an old failure source cannot masquerade as current external state', () => {
  assert.throws(
    () =>
      parseCurrentStateBeforeRemediationEvidence(
        'supabase',
        [
          '--remediation-planned',
          '--current-state-checked',
          '--current-state-source=workflow-run:33512300451 failure log',
          '--evidence-verdict=refresh-required'
        ],
        {}
      ),
    /old workflow failure, log, ledger, or release document alone is insufficient/
  );
});

test(
  'fresh current state proving a real gap allows only refresh-required remediation',
  () => {
    const evidence = parseCurrentStateBeforeRemediationEvidence(
      'supabase',
      remediationArgs('refresh-required'),
      {}
    );

    assert.equal(evidence.required, true);
    assert.equal(evidence.checked, true);
    assert.equal(evidence.source, 'current-state:supabase-migration-history');
    assert.equal(evidence.remediationPlanned, true);
    assert.equal(evidence.verdict, 'refresh-required');
  }
);

test(
  'fresh current state blocks stale-failure remediation when the goal is already satisfied',
  () => {
    assert.throws(
      () =>
        parseCurrentStateBeforeRemediationEvidence(
          'supabase',
          remediationArgs('current'),
          {}
        ),
      /Stale-failure remediation blocked/
    );
  }
);

test('fresh current state also blocks duplicate external mutation', () => {
  assert.throws(
    () =>
      parseCurrentStateBeforeRemediationEvidence(
        'supabase',
        mutationArgs('current'),
        {}
      ),
    /Stale-failure remediation blocked/
  );
});

test(
  'contracts cover Staging, secret guidance, and unknown application paths',
  () => {
    for (const token of [
      'failed workflow, or missing-configuration error',
      'fresh read-only observation of the current target state',
      'Staging and Production',
      'Secret/configuration remediation',
      'credential reset instruction',
      'must not be prescribed as necessary',
      'Do not invent the mechanism by which current state changed',
      '--current-state-checked',
      '--current-state-source',
      '--remediation-planned'
    ]) {
      assert.equal(evidenceContract.includes(token), true, token);
    }

    for (const token of [
      '古い失敗からのremediation再開ゲート',
      'freshなread-only current-state',
      'StagingとProductionの両方',
      'Secret・password・設定変更・再承認・再実行',
      '完了状態と適用経路の証明を分離する'
    ]) {
      assert.equal(automationContract.includes(token), true, token);
    }

    assert.match(
      wrapper,
      /state\.version = Math\.max\(Number\(state\.version\) \|\| 0, 11\)/
    );
    assert.match(wrapper, /state\.currentStateBeforeRemediation/);
  }
);
