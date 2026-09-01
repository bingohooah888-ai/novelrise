import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('assistant auto-resume contract avoids needless continuation prompts without weakening safety', async () => {
  const gate = await read('docs/AUTOMATION-CONTINUATION-GATE.md');

  assert.match(gate, /### Connector capability bootstrap/);
  assert.match(gate, /tool schemaだけを返す/);
  assert.match(gate, /latest `main` lookupより前に1回だけ実行してよい/);
  assert.match(
    gate,
    /MASTER-first違反として扱ってユーザーへ新しい「はい」「続けて」を要求してはならない/
  );

  assert.match(gate, /### アシスタント側の回復可能エラー自動再開/);
  assert.match(gate, /同じターンで継続する/);
  assert.match(gate, /同じ承認文を再送してください/);
  assert.match(gate, /カードより前にツールを呼んだ/);
  assert.match(gate, /one-time requestをclaimした/);

  assert.match(gate, /### 未消費承認のcarry-forward/);
  assert.match(
    gate,
    /外部request \/ claim \/ mutationがまだ一度も開始されていない/
  );
  assert.match(
    gate,
    /final-head SHA \/ challengeへ固定されたHigh-Risk PR承認/
  );
  assert.match(gate, /Production DB、Production Secret、Stripe live/);
  assert.match(gate, /`CLAIMED` または `CONSUMED`/);
});
