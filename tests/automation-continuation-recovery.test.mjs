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

test('MASTER keeps MASTER-first, no-dummy-continuation, and image default-deny rules', async () => {
  const master = await read('docs/NOVELIGHT-MASTER.md');
  const preflight = await read('docs/WORK-EXECUTION-PREFLIGHT.md');
  const turnGate = await read('docs/EXECUTION-TURN-CARD-GATE.md');
  const imageGate = await read('docs/IMAGE-EXECUTION-GATE.md');

  assert.ok(master.includes(NO_DUMMY_CONTINUATION_RULE));
  assert.match(master, /MASTER-first Bootstrap/);
  assert.match(master, /`MASTER_READ_COMPLETE`/);
  assert.match(
    master,
    /repository search、profile確認、repository一覧取得等の不要な探索を挟まない/
  );
  assert.match(master, /同じターン内でlatest main解決とMASTER全文読了をやり直して自動復旧/);
  assert.match(master, /画像ツール既定拒否/);
  assert.match(master, /ChatGPT側の画像生成・画像編集ツールを新しいユーザーメッセージごとに既定でロック/);

  assert.match(preflight, /画像生成・画像編集の明示実行ゲート/);
  assert.match(turnGate, /MASTER-first read gate/);
  assert.match(turnGate, /do not ask the user for `はい`, `続けて`/);
  assert.match(imageGate, /LOCKED by default for every NOVELIGHT user message/);
});

test('routine continuation does not become an approval gate', () => {
  assert.equal(shouldRequireUserDecision(), false);
  assert.equal(shouldRequireUserDecision({ genuineChoice: true }), true);
  assert.equal(shouldRequireUserDecision({ production: true }), true);
  assert.equal(shouldRequireUserDecision({ secret: true }), true);
  assert.equal(shouldRequireUserDecision({ destructive: true }), true);
  assert.equal(shouldRequireUserDecision({ payment: true }), true);
});
