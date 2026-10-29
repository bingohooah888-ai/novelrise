import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) =>
  readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('evidence-first cross-chat policy is linked from MASTER and AGENTS', () => {
  const master = read('docs/NOVELIGHT-MASTER.md');
  const agents = read('AGENTS.md');
  const policy = read('docs/REAL-ENV-EVIDENCE-FIRST-POLICY.md');

  for (const source of [master, agents]) {
    assert.match(source, /docs\/REAL-ENV-EVIDENCE-FIRST-POLICY\.md/u);
    assert.match(source, /別チャット/u);
    assert.match(source, /実環境/u);
  }
  assert.match(agents, /CI PASS ≠ 実環境検証済み/u);
  assert.match(master, /2026年10月29日追補：実環境証拠優先/u);
  assert.match(policy, /実環境証拠優先・再試験抑制ポリシー/u);
});

test('evidence-first policy preserves one-use approvals and failure boundaries', () => {
  const agents = read('AGENTS.md');
  const policy = read('docs/REAL-ENV-EVIDENCE-FIRST-POLICY.md');

  assert.match(policy, /同種失敗が2回/u);
  assert.match(policy, /独立した最小read-only診断経路/u);
  assert.match(policy, /同じ承認・同じ試験を自動再実行しない/u);
  assert.match(policy, /Secret、Auth token/u);
  assert.match(policy, /PASS \/ FAIL \/ NOT RUN \/ BLOCKED/u);
  assert.match(policy, /FAST PATCH/u);
  assert.match(agents, /同種失敗が2回/u);
  assert.match(agents, /`本番承認`/u);
  assert.match(agents, /`ステージング承認`/u);
});
