import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyHardStop,
  parsePhase,
  shouldRequireUserDecision,
} from '../scripts/runtime-execution-gate.mjs';

const PREFLIGHT_PATH = 'docs/WORK-EXECUTION-PREFLIGHT.md';
const AUTOMATION_PATH = 'docs/AUTOMATION-CONTINUATION-GATE.md';
const PACKAGE_PATH = 'package.json';
const RUNTIME_GATE_PATH = 'scripts/runtime-execution-gate.mjs';

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
  ]);
});

test('wait continuation contract', async () => {
  const source = await read(PREFLIGHT_PATH);
  assertIncludesAll(source, [
    '短時間外部待機・自動継続ゲート',
    '概ね10分以内',
    '「実行中です」だけで返していない',
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
    '実行環境の上位制約',
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
    '作業開始時だけでなく、主要工程の切替ごとに必須とする',
  ]);
});

test('runtime gate is wired into agent preflight', async () => {
  const packageJson = JSON.parse(await read(PACKAGE_PATH));
  assert.equal(
    packageJson.scripts['runtime:gate'],
    'node scripts/runtime-execution-gate.mjs',
  );
  assert.match(packageJson.scripts['preflight:agent'], /runtime:gate/u);

  const source = await read(RUNTIME_GATE_PATH);
  assertIncludesAll(source, [
    "git(['fetch', '--quiet', 'origin', 'main'])",
    'origin/main:docs/NOVELIGHT-MASTER.md',
    'origin/main:docs/WORK-EXECUTION-PREFLIGHT.md',
    'NOVELIGHT Runtime Execution Gate: PASS',
    'do not ask for a continuation-only yes',
  ]);
});

test('runtime gate hard stops are limited to real decision boundaries', () => {
  assert.equal(
    classifyHardStop({
      production: true,
      secret: false,
      destructive: false,
      payment: false,
    }),
    true,
  );
  assert.equal(
    classifyHardStop({
      production: false,
      secret: false,
      destructive: false,
      payment: false,
    }),
    false,
  );
  assert.equal(shouldRequireUserDecision({ genuineChoice: true }), true);
  assert.equal(shouldRequireUserDecision({}), false);
  assert.equal(parsePhase(['--phase=vercel']), 'vercel');
  assert.throws(() => parsePhase(['--phase=unknown']), /Unsupported/u);
});

test('screenshot verification gate contract', async () => {
  const source = await read(AUTOMATION_PATH);
  assertIncludesAll(source, [
    'スクリーンショット・画面確認ゲート',
    '過去画像・別画面・推測を現在画面として扱わない',
    '画像内で確認できない情報を「見えている」と断定していないか',
    '画像から確認できない項目は推測で補完しない',
  ]);
});
