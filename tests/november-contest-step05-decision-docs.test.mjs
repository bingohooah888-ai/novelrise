import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function report(name) {
  return readFileSync(new URL(`../docs/reports/${name}`, import.meta.url), 'utf8');
}

test('stage 05 terms and internal runbook reflect owner-approved award timing', () => {
  const draft = report('NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md');
  const runbook = report('NOVEMBER-CONTEST-STEP05-REGISTRATION-RUNBOOK.md');
  const decisionHistory = report('NOVEMBER-CONTEST-STEP05-DECISION-PACK-20261012.md');
  assert.match(draft, /返信を受信した日から1か月以内/);
  assert.match(runbook, /返信を受信した日から1か月以内/);
  assert.match(decisionHistory, /返信を受信した日から1か月以内/);
  assert.match(draft, /有効得点が1pt以上/);
  assert.match(draft, /R18・AI生成主体/);
  assert.match(draft, /2026年12月1日/);
  assert.match(runbook, /R1〜R11は2026-10-12にオーナー決裁済み/);
  assert.match(runbook, /非公開状態の.*404が正常/);
  assert.match(runbook, /20261012135000/);
  assert.doesNotMatch(runbook, /R1〜R11の未決裁提案は/);
  assert.match(decisionHistory, /決裁前の提案記録/);
});
