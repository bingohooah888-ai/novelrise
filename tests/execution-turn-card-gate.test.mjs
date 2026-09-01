import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyBootstrapRecovery,
  parseEvidenceFreshnessEvidence,
  parseExecutionCardEvidence,
  parseMasterReadEvidence
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

function masterFixture() {
  const mainSha = 'a'.repeat(40);
  const contentSha256 = 'b'.repeat(64);
  const authoritative = {
    mainSha,
    master: { sha256: contentSha256, lines: 1529 }
  };
  const args = [
    '--master-read-complete',
    `--master-main-sha=${mainSha}`,
    `--master-content-sha256=${contentSha256}`,
    '--master-covered-from=1',
    '--master-covered-through=1529',
    '--master-eof-line=1529'
  ];
  return { mainSha, contentSha256, authoritative, args };
}

test('all execution governance layers retain the first-visible-message rule', () => {
  for (const text of [agents, preflight, continuation]) {
    assert.match(text, /最初のユーザー可視メッセージ/);
    assert.match(text, /カード送信前.*ツール呼び出し.*禁止/s);
  }

  assert.match(contract, /Zero-tool rule/);
  assert.match(contract, /first visible message/i);
  assert.match(contract, /omit time information from the user-visible card/);
  assert.match(contract, /late card after pre-card tool use/i);
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

test('MASTER_READ_COMPLETE binds exact main, digest, contiguous coverage, and EOF', () => {
  const { mainSha, contentSha256, authoritative, args } = masterFixture();
  const evidence = parseMasterReadEvidence(
    'implementation',
    args,
    {},
    authoritative
  );
  assert.equal(evidence.required, true);
  assert.equal(evidence.status, 'MASTER_READ_COMPLETE');
  assert.equal(evidence.mainSha, mainSha);
  assert.equal(evidence.contentSha256, contentSha256);
  assert.equal(evidence.coveredFrom, 1);
  assert.equal(evidence.coveredThrough, 1529);
  assert.equal(evidence.eofLine, 1529);
});

test('incomplete, truncated, stale, or noncontiguous MASTER proof fails closed', () => {
  const { authoritative, args } = masterFixture();

  assert.throws(
    () => parseMasterReadEvidence('implementation', [], {}, authoritative),
    /MASTER_READ_COMPLETE/
  );
  assert.throws(
    () =>
      parseMasterReadEvidence(
        'implementation',
        [...args, '--master-unresolved-truncation'],
        {},
        authoritative
      ),
    /truncated or unresolved/
  );
  assert.throws(
    () =>
      parseMasterReadEvidence(
        'implementation',
        args.map((arg) =>
          arg.startsWith('--master-covered-through=')
            ? '--master-covered-through=1528'
            : arg
        ),
        {},
        authoritative
      ),
    /contiguous through the confirmed EOF/
  );
  assert.throws(
    () =>
      parseMasterReadEvidence(
        'implementation',
        args.map((arg) =>
          arg.startsWith('--master-main-sha=')
            ? `--master-main-sha=${'c'.repeat(40)}`
            : arg
        ),
        {},
        authoritative
      ),
    /different main SHA/
  );
  assert.throws(
    () =>
      parseMasterReadEvidence(
        'implementation',
        args.map((arg) =>
          arg.startsWith('--master-content-sha256=')
            ? `--master-content-sha256=${'d'.repeat(64)}`
            : arg
        ),
        {},
        authoritative
      ),
    /digest does not match/
  );

  assert.equal(
    parseMasterReadEvidence('start', [], {}, authoritative).required,
    false
  );
});

test('read-only bootstrap-order mistake resets in-turn but real safety boundaries stay hard-fail', () => {
  assert.equal(
    classifyBootstrapRecovery({
      cardVisible: true,
      readOnlyProjectReadBeforeMasterComplete: true
    }),
    'recoverable-reset-retry'
  );
  assert.equal(
    classifyBootstrapRecovery({
      cardVisible: false,
      readOnlyProjectReadBeforeMasterComplete: true
    }),
    'hard-fail'
  );

  for (const boundary of [
    'toolBeforeCard',
    'unauthorizedImageTool',
    'externalMutationStarted',
    'secretOperationStarted',
    'productionOperationStarted',
    'destructiveOperationStarted',
    'billingOperationStarted',
    'oneTimeClaimOrConsumeStarted'
  ]) {
    assert.equal(
      classifyBootstrapRecovery({
        cardVisible: true,
        readOnlyProjectReadBeforeMasterComplete: true,
        [boundary]: true
      }),
      'hard-fail',
      boundary
    );
  }
});

test('MASTER contracts require truncation retry and same-turn read-only recovery', () => {
  assert.match(contract, /MASTER_READ_COMPLETE/);
  assert.match(contract, /visibly truncated/i);
  assert.match(contract, /contiguous/i);
  assert.match(contract, /confirmed EOF/i);
  assert.match(contract, /read-only bootstrap-order/i);
  assert.match(contract, /same assistant turn/i);
  assert.match(contract, /Do not ask the user for `はい`, `続けて`/i);

  assert.match(continuation, /MASTER_READ_COMPLETE/);
  assert.match(continuation, /MASTER-first違反のread-only bootstrap自動リセット/);
  assert.match(continuation, /同じターン/);
  assert.match(continuation, /破棄/);
  assert.match(continuation, /新しい「はい」「続けて」を要求してはならない/);
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

test('runtime gate treats execution, MASTER, and freshness contracts as authoritative', () => {
  assert.match(runtimeGate, /docs\/EXECUTION-TURN-CARD-GATE\.md/);
  assert.match(runtimeGate, /docs\/EVIDENCE-FRESHNESS-GATE\.md/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_WORKLOAD/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_OTHER_WORK/);
  assert.match(runtimeGate, /NOVELIGHT_EXECUTION_CARD_NEXT_USER_ACTION/);
  assert.match(runtimeGate, /NOVELIGHT_MASTER_READ_COMPLETE/);
  assert.match(runtimeGate, /NOVELIGHT_MASTER_UNRESOLVED_TRUNCATION/);
  assert.match(runtimeGate, /masterRead/);
  assert.match(runtimeGate, /NOVELIGHT_EVIDENCE_FRESHNESS_CHECKED/);
  assert.match(runtimeGate, /NOVELIGHT_EVIDENCE_DUPLICATE_CHECK/);
  assert.match(runtimeGate, /NOVELIGHT_MUTATION_PLANNED/);
  assert.match(runtimeGate, /version: 11/);
});