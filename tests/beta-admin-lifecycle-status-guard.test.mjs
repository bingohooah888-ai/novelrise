import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const adminHtml = read('admin-beta-authors.html');
const adminApi = read('api/admin-beta-authors.js');

test('beta admin API treats lifecycle milestones as forward-only', () => {
  assert.match(adminApi, /const LIFECYCLE_STATUS_RANK = new Map\(\[/);
  for (const [status, rank] of [
    ['preregistered', 0],
    ['verified', 1],
    ['invited', 2],
    ['registered', 3],
    ['first_novel', 4]
  ]) {
    assert.match(adminApi, new RegExp(`\\['${status}', ${rank}\\]`));
  }
  assert.match(adminApi, /function lifecycleRankForRecord\(record\)/);
  assert.match(adminApi, /record\?\.email_verified[\s\S]*Math\.max\(rank, 1\)/);
  assert.match(adminApi, /record\?\.invite_sent_at[\s\S]*Math\.max\(rank, 2\)/);
  assert.match(adminApi, /record\?\.registered_at[\s\S]*Math\.max\(rank, 3\)/);
  assert.match(adminApi, /record\?\.first_novel_at[\s\S]*Math\.max\(rank, 4\)/);
  assert.match(
    adminApi,
    /function isBackwardLifecycleTransition\(current, nextStatus\)/
  );
  assert.match(
    adminApi,
    /const currentRank = lifecycleRankForRecord\(current\)/
  );
  assert.match(adminApi, /nextRank < currentRank/);
  assert.match(
    adminApi,
    /if \(isBackwardLifecycleTransition\(current, status\)\)/
  );
  assert.match(adminApi, /error\.code = 'LIFECYCLE_STATUS_CONFLICT'/);
  assert.match(
    adminApi,
    /error\?\.code === 'LIFECYCLE_STATUS_CONFLICT'[\s\S]*res\.status\(409\)/
  );
});

test('beta admin keeps cancellation outside lifecycle rank and preserves milestone history', () => {
  const rankBlock = adminApi.match(
    /const LIFECYCLE_STATUS_RANK = new Map\(\[([\s\S]*?)\]\);/
  )?.[1];
  assert.ok(rankBlock);
  assert.doesNotMatch(rankBlock, /cancelled/);
  assert.doesNotMatch(adminApi, /patch\.invite_sent_at\s*=\s*null/);
  assert.doesNotMatch(adminApi, /patch\.registered_at\s*=\s*null/);
  assert.doesNotMatch(adminApi, /patch\.first_novel_at\s*=\s*null/);
  assert.doesNotMatch(adminApi, /patch\.email_verified\s*=\s*false/);
});

test('beta admin UI disables only lifecycle choices below the achieved milestone floor', () => {
  assert.match(
    adminHtml,
    /const lifecycleStatusRank=\{preregistered:0,verified:1,invited:2,registered:3,first_novel:4\}/
  );
  assert.match(adminHtml, /function lifecycleRankForRecord\(row\)/);
  assert.match(adminHtml, /row\?\.first_novel_at[\s\S]*Math\.max\(rank,4\)/);
  assert.match(adminHtml, /function configureStatusOptions\(current\)/);
  assert.match(
    adminHtml,
    /option\.disabled=Number\.isInteger\(optionRank\)&&currentRank>=0&&optionRank<currentRank/
  );
  assert.match(adminHtml, /configureStatusOptions\(selected\)/);
  assert.match(adminHtml, /すでに到達した段階より前のステータスには戻せません/);
  assert.match(adminHtml, /取消は従来どおり選択できます/);
  assert.match(adminHtml, /取消後に戻す場合も到達済み段階より前には戻せません/);
  assert.match(
    adminHtml,
    /statusEl\.textContent=error\?\.message\|\|'先行登録の変更を保存できませんでした。'/
  );
});
