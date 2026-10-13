import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const reportsRoot = new URL('../docs/reports/', import.meta.url);

function report(name) {
  return readFileSync(new URL(name, reportsRoot), 'utf8');
}

test('stage 05 terms and runbook align on award timing', () => {
  const draft = report('NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md');
  const runbook = report('NOVEMBER-CONTEST-STEP05-REGISTRATION-RUNBOOK.md');
  const pack = report('NOVEMBER-CONTEST-STEP05-DECISION-PACK-20261012.md');

  const paymentRule = /返信を受信した日から1か月以内/;
  assert.match(draft, paymentRule);
  assert.match(runbook, paymentRule);
  assert.match(pack, paymentRule);
  assert.match(draft, /有効得点が1pt以上/);
  assert.match(draft, /R18・AI生成主体/);
  assert.match(draft, /2026年12月1日/);
  assert.match(runbook, /R1〜R11は2026-10-12にオーナー決裁済み/);
  assert.match(runbook, /非公開状態の.*404が正常/);
  assert.match(runbook, /20261012135000/);
  assert.match(runbook, /応募資格制限migration/);
  assert.match(runbook, /参加資格R2.*決裁済み/);
  assert.doesNotMatch(runbook, /参加許可カテゴリーと専用ゾーン掲載は未決裁/);
  assert.doesNotMatch(runbook, /R1〜R11の未決裁提案は/);
  assert.match(pack, /決裁前の提案記録/);
});
