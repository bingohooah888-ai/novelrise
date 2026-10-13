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
  assert.match(draft, /振込ができなかった場合/);
  assert.match(draft, /振込後に返金された場合/);
  assert.match(draft, /原則として同じ賞金の再振込は行いません/);
  assert.match(draft, /銀行の取引履歴・返金状況/);
  assert.match(runbook, /振込不能・振込後の返金/);
  assert.match(runbook, /公開要項では約束しない/);
  const approval = report('NOVEMBER-CONTEST-STEP05-APPROVAL-READY-20261013.md');
  assert.match(approval, /振込不能・返金時は受賞者へ再連絡/);

  assert.match(draft, /R18・AI生成主体/);
  assert.match(draft, /2026年12月1日/);
  assert.match(runbook, /R1〜R11は2026-10-12にオーナー決裁済み/);
  assert.match(runbook, /非公開状態の.*404が正常/);
  assert.match(runbook, /20261012135000/);
  assert.match(runbook, /非公開ページ基盤.*本番反映済み/);
  assert.match(runbook, /応募資格制限migration `20261012135000` は適用済み/);
  assert.match(runbook, /送信と受信はenabled/);
  assert.match(runbook, /公開・送信は禁止/);
  assert.match(runbook, /応募資格制限migration/);
  assert.match(runbook, /参加資格R2.*決裁済み/);
  assert.doesNotMatch(runbook, /参加許可カテゴリーと専用ゾーン掲載は未決裁/);
  assert.doesNotMatch(runbook, /R1〜R11の未決裁提案は/);
  assert.match(pack, /決裁前の提案記録/);
});

test('stage 05 current checkpoint supersedes historical notes', () => {
  const runbook = report('NOVEMBER-CONTEST-STEP05-REGISTRATION-RUNBOOK.md');
  const approval = report('NOVEMBER-CONTEST-STEP05-APPROVAL-READY-20261013.md');

  const marker = '## 現行Productionスナップショット';
  const snapshot = runbook.split(marker)[1]?.split('## 3段階')[0];
  assert.ok(snapshot, 'Current Production snapshot is required');
  assert.match(snapshot, /169件/);
  assert.match(snapshot, /20261012135000.*適用済み/);
  assert.match(snapshot, /6経路とも404/);
  assert.match(snapshot, /entries=0|応募0件/);
  assert.match(snapshot, /受付開始承認/);
  assert.match(snapshot, /⑥読書ポイントの実装.*まだ着手しない/);

  const currentHeader = runbook.split('## 現行Productionスナップショット')[0];
  assert.match(currentHeader, /応募資格制限migration.*適用済み/);
  assert.doesNotMatch(currentHeader, /応募資格制限migration.*未適用/);

  const approvalHeader = approval.split('## 最新の公開前検証証跡')[0];
  assert.match(approvalHeader, /応募資格migration.*適用済み/);
  assert.doesNotMatch(approvalHeader, /応募資格migration.*未適用/);
  assert.match(approval, /HTTP実測で404/);
});
