import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('assistant recovery stays automatic and fail-closed', async () => {
  const gate = await read('docs/AUTOMATION-CONTINUATION-GATE.md');
  const patterns = [
    /### Connector capability bootstrap/,
    /tool schemaだけを返す/,
    /latest `main` lookupより前に1回だけ実行してよい/,
    /MASTER-first違反/,
    /新しい「はい」「続けて」を要求してはならない/,
    /### アシスタント側の回復可能エラー自動再開/,
    /同じターンで継続する/,
    /同じ承認文を再送/,
    /カードより前にツールを呼んだ/,
    /one-time requestをclaimした/,
    /### 未消費承認のcarry-forward/,
    /外部request \/ claim \/ mutation/,
    /final-head SHA \/ challenge/,
    /Production DB、Production Secret、Stripe live/,
    /`CLAIMED` または `CONSUMED`/,
  ];

  for (const pattern of patterns) {
    assert.match(gate, pattern);
  }
});
