import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyHardStop,
  parseExecutionCardEvidence,
  parsePhase,
  shouldRequireUserDecision
} from '../scripts/runtime-execution-gate.mjs';

const AGENTS_PATH = 'AGENTS.md';
const PREFLIGHT_PATH = 'docs/WORK-EXECUTION-PREFLIGHT.md';
const AUTOMATION_PATH = 'docs/AUTOMATION-CONTINUATION-GATE.md';
const PACKAGE_PATH = 'package.json';
const RUNTIME_GATE_PATH = 'scripts/runtime-execution-gate.mjs';
const STAGING_PROOF_PATH = '.github/workflows/staging-live-proof.yml';
const VERCEL_PATH = 'vercel.json';

async function read(path) {
  return readFile(path, 'utf8');
}

function assertIncludesAll(source, tokens) {
  for (const token of tokens) {
    assert.equal(source.includes(token), true, token);
  }
}

test('timing gate contract', async () => {
  const source = await read(PREFLIGHT_PATH);
  assertIncludesAll(source, [
    '可視時間報告 Fail-Closed ゲート',
    'トータル予想時間',
    '主要工程',
    '手動操作',
    '待機要否',
    '実行環境の上位制約',
    'Degraded-Continue'
  ]);
});

test('execution card resets on every tool-using assistant turn', async () => {
  const preflight = await read(PREFLIGHT_PATH);
  const agents = await read(AGENTS_PATH);
  const automation = await read(AUTOMATION_PATH);

  for (const source of [preflight, agents, automation]) {
    assertIncludesAll(source, [
      '実行ターン',
      '最初のユーザー可視メッセージ',
      '前ターンのカード',
      'スクリーンショット'
    ]);
  }

  assertIncludesAll(preflight, [
    'カード送信前のツール呼び出しは禁止',
    '次のユーザーメッセージを受けた時点で必ず失効する',
    '読み取り専用Bootstrap'
  ]);
  assertIncludesAll(automation, [
    '同じアシスタントターンで可視実行カードを先に送信していなければConnector/APIを呼び出さない',
    'ユーザーから新しいメッセージを受けた場合',
    'スクリーンショットを受けてGitHub/Vercel/Connector等のツール作業を再開する場合'
  ]);
});

test('wait continuation contract', async () => {
  const source = await read(PREFLIGHT_PATH);
  assertIncludesAll(source, [
    '短時間外部待機・自動継続ゲート',
    '概ね10分以内',
    '「実行中です」だけで返していない'
  ]);
});

test('approval-button elimination contract', async () => {
  const source = await read(AUTOMATION_PATH);
  assertIncludesAll(source, [
    '判断を伴わない承認は要求しない',
    '続行ボタン禁止ゲート',
    '1回目から自動化対象',
    '承認質問は禁止し、自動継続する',
    '自動停止を残す場面',
    '実行環境の上位制約'
  ]);
});

test('per-step runtime execution gate contract', async () => {
  const source = await read(AUTOMATION_PATH);
  assertIncludesAll(source, [
    '主要工程 Runtime Execution Gate',
    '正式基準',
    '禁止・ロック',
    '可視実行カード',
    '自動化経路',
    'npm run runtime:gate',
    'ユーザーの追加の「はい」を待たず実行へ進む',
    '作業開始時だけでなく、主要工程の切替ごとに必須とする'
  ]);
});

test('repository agent instructions require the executable gate', async () => {
  const source = await read(AGENTS_PATH);
  assertIncludesAll(source, [
    '## Runtime Execution Gate',
    '### Execution Turn Card Gate',
    'npm run runtime:gate -- --phase=<phase>',
    'GitHub Connector/APIで最新main SHA、MASTER、Preflightを直接再取得',
    '単なる続行ボタンになる場合は要求しない',
    'Degraded-Continue',
    'ユーザーから新しいメッセージを受けた時点で前ターンのカードは失効'
  ]);
});

test('runtime gate is wired into agent preflight', async () => {
  const packageJson = JSON.parse(await read(PACKAGE_PATH));
  assert.equal(
    packageJson.scripts['runtime:gate'],
    'node scripts/runtime-execution-gate.mjs'
  );
  assert.match(packageJson.scripts['preflight:agent'], /runtime:gate/u);

  const source = await read(RUNTIME_GATE_PATH);
  assertIncludesAll(source, [
    '+refs/heads/main:refs/remotes/origin/main',
    'origin/main:${path}',
    'docs/NOVELIGHT-MASTER.md',
    'docs/WORK-EXECUTION-PREFLIGHT.md',
    'NOVELIGHT Runtime Execution Gate: PASS',
    'do not ask for a continuation-only yes',
    'NOVELIGHT_EXECUTION_CARD_VISIBLE',
    'Execution turn card is not acknowledged as user-visible in this assistant turn.',
    'Timed execution turn card must include total estimated time.'
  ]);
});

test('runtime gate fails closed without current-turn card evidence', () => {
  assert.throws(
    () => parseExecutionCardEvidence([], {}),
    /not acknowledged as user-visible/u
  );

  assert.deepEqual(
    parseExecutionCardEvidence([
      '--card-visible',
      '--card-total=15-25m',
      '--card-steps=3',
      '--card-manual=0',
      '--card-wait=none'
    ]),
    {
      visible: true,
      mode: 'timed',
      total: '15-25m',
      steps: '3',
      manual: '0',
      wait: 'none',
      reason: ''
    }
  );

  assert.deepEqual(
    parseExecutionCardEvidence([
      '--card-visible',
      '--card-mode=degraded',
      '--card-steps=3',
      '--card-manual=0',
      '--card-wait=none',
      '--card-reason=host-policy'
    ]),
    {
      visible: true,
      mode: 'degraded',
      total: '',
      steps: '3',
      manual: '0',
      wait: 'none',
      reason: 'host-policy'
    }
  );
});

test('runtime gate hard stops are limited to real decision boundaries', () => {
  assert.equal(
    classifyHardStop({
      production: true,
      secret: false,
      destructive: false,
      payment: false
    }),
    true
  );
  assert.equal(
    classifyHardStop({
      production: false,
      secret: false,
      destructive: false,
      payment: false
    }),
    false
  );
  assert.equal(shouldRequireUserDecision({ genuineChoice: true }), true);
  assert.equal(shouldRequireUserDecision({}), false);
  assert.equal(parsePhase(['--phase=vercel']), 'vercel');
  assert.throws(() => parsePhase(['--phase=unknown']), /Unsupported/u);
});

test('staging live proof mirrors Vercel deployment-disabled branches', async () => {
  const workflow = await read(STAGING_PROOF_PATH);
  const vercel = JSON.parse(await read(VERCEL_PATH));
  const deploymentEnabled = vercel.git?.deploymentEnabled ?? {};
  const disabledPrefixes = Object.entries(deploymentEnabled)
    .filter(([, enabled]) => enabled === false)
    .map(([pattern]) => pattern.replace('/**', '/'));

  assert.deepEqual(disabledPrefixes, [
    'chore/',
    'test/',
    'docs/',
    'dependabot/'
  ]);

  for (const prefix of disabledPrefixes) {
    assert.equal(
      workflow.includes(`!startsWith(github.head_ref, '${prefix}')`),
      true,
      `Live Proof must skip Vercel-disabled branch prefix: ${prefix}`
    );
  }

  assertIncludesAll(workflow, [
    "github.event_name == 'workflow_dispatch'",
    'MANUAL_PREVIEW_URL',
    'Preview URL is required for workflow_dispatch.'
  ]);
});

test('screenshot verification gate contract', async () => {
  const source = await read(AUTOMATION_PATH);
  assertIncludesAll(source, [
    'スクリーンショット・画面確認ゲート',
    '過去画像・別画面・推測を現在画面として扱わない',
    '画像内で確認できない情報を「見えている」と断定していないか',
    '画像から確認できない項目は推測で補完しない'
  ]);
});
