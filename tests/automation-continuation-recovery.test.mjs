import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { shouldRequireUserDecision } from '../scripts/runtime-execution-gate.mjs';

const read = (path) => readFile(path, 'utf8');

const NO_DUMMY_CONTINUATION_RULE =
  '報告・再見積もり・工程切替・チャット継続判定は、ユーザー承認ゲートではない。明示的な承認要件または合理的停止理由がない限り、ユーザーの「続けて」「はい」等を要求せず、そのまま次工程へ着手する。';

test('assistant recovery stays automatic and fail-closed', async () => {
  const gate = await read('docs/AUTOMATION-CONTINUATION-GATE.md');
  const patterns = [
    /### Connector capability bootstrap/,
    /tool schemaだけを返す/,
    /latest `main` lookupより前に1回だけ実行してよい/,
    /### MASTER_READ_COMPLETE bootstrap/,
    /visibly truncated/,
    /連続coverage/,
    /MASTER-first違反のread-only bootstrap自動リセット/,
    /同じターン/,
    /破棄/,
    /新しい「はい」「続けて」を要求してはならない/,
    /### アシスタント側の回復可能エラー自動再開/,
    /同じ承認文を再送/,
    /カードより前にツールを呼んだ/,
    /one-time requestのCLAIM\/CONSUME/,
    /### 未消費承認のcarry-forward/,
    /外部request \/ claim \/ mutation/,
    /final-head SHA \/ challenge/,
    /Production DB、Production Secret、Stripe live/,
    /`CLAIMED` または `CONSUMED`/
  ];

  for (const pattern of patterns) {
    assert.match(gate, pattern);
  }
});

test('MASTER locks execution discipline', async () => {
  const master = await read('docs/NOVELIGHT-MASTER.md');
  assert.ok(master.includes(NO_DUMMY_CONTINUATION_RULE));

  for (const pattern of [
    /MASTER-first Bootstrap/,
    /`MASTER_READ_COMPLETE`/,
    /同じターン内でlatest main解決/,
    /画像ツール既定拒否/,
    /明示的に解除・再有効化/
  ]) {
    assert.match(master, pattern);
  }
});

test('routine continuation is not approval', () => {
  assert.equal(shouldRequireUserDecision(), false);
  assert.equal(shouldRequireUserDecision({ genuineChoice: true }), true);
  assert.equal(shouldRequireUserDecision({ production: true }), true);
  assert.equal(shouldRequireUserDecision({ secret: true }), true);
  assert.equal(shouldRequireUserDecision({ destructive: true }), true);
  assert.equal(shouldRequireUserDecision({ payment: true }), true);
});
