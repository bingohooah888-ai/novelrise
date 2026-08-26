import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PREFLIGHT_PATH = 'docs/WORK-EXECUTION-PREFLIGHT.md';

async function readPreflight() {
  return readFile(PREFLIGHT_PATH, 'utf8');
}

test(
  'work execution preflight requires visible total-time reporting before tools',
  async () => {
    const source = await readPreflight();

    assert.match(source, /可視時間報告 Fail-Closed ゲート/);
    assert.match(source, /トータル予想時間/);
    assert.match(source, /主要工程/);
    assert.match(source, /手動操作/);
    assert.match(source, /待機要否/);
    assert.match(source, /ツール実行禁止/);
  },
);

test(
  'work execution preflight requires short external waits to continue automatically',
  async () => {
    const source = await readPreflight();

    assert.match(source, /短時間外部待機・自動継続ゲート/);
    assert.match(source, /概ね10分以内/);
    assert.match(
      source,
      /同じターンで結果確認・必要なログ診断・安全に自動実行できる次工程まで続行/,
    );
    assert.match(source, /「実行中です」だけで返していない/);
  },
);
