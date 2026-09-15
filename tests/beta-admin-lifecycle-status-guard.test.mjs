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
  assert.match(
    adminApi,
    /function isBackwardLifecycleTransition\(currentStatus, nextStatus\)/
  );
  assert.match(
    adminApi,
    /nextRank < currentRank/
  );
  assert.match(
    adminApi,
    /if \(isBackwardLifecycleTransition\(current\.status, status\)\)/
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

test('beta admin UI disables only earlier lifecycle choices', () => {
  assert.match(
    adminHtml,
    /const lifecycleStatusRank=\{preregistered:0,verified:1,invited:2,registered:3,first_novel:4\}/
  );
  assert.match(adminHtml, /function configureStatusOptions\(currentStatus\)/);
  assert.match(
    adminHtml,
    /option\.disabled=Number\.isInteger\(currentRank\)&&Number\.isInteger\(optionRank\)&&optionRank<currentRank/
  );
  assert.match(adminHtml, /configureStatusOptions\(selected\.status\)/);
  assert.match(adminHtml, /すでに到達した段階より前のステータスには戻せません/);
  assert.match(adminHtml, /取消は従来どおり選択できます/);
});
