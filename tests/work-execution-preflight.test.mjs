import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PREFLIGHT_PATH = 'docs/WORK-EXECUTION-PREFLIGHT.md';
const AUTOMATION_PATH = 'docs/AUTOMATION-CONTINUATION-GATE.md';

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
    'ツール実行禁止',
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
    'トータル予想時間',
  ]);
});
