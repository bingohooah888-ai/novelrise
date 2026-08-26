import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PREFLIGHT_PATH = 'docs/WORK-EXECUTION-PREFLIGHT.md';

async function readPreflight() {
  return readFile(PREFLIGHT_PATH, 'utf8');
}

// prettier-ignore
function assertIncludesAll(source, tokens) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `Missing preflight contract: ${token}`);
  }
}

// prettier-ignore
test('timing gate contract', async () => {
  const source = await readPreflight();
  assertIncludesAll(source, [
    '可視時間報告 Fail-Closed ゲート',
    'トータル予想時間',
    '主要工程',
    '手動操作',
    '待機要否',
    'ツール実行禁止',
  ]);
});

// prettier-ignore
test('wait continuation contract', async () => {
  const source = await readPreflight();
  assertIncludesAll(source, [
    '短時間外部待機・自動継続ゲート',
    '概ね10分以内',
    '同じターンで結果確認・必要なログ診断・安全に自動実行できる次工程まで続行',
    '「実行中です」だけで返していない',
  ]);
});
