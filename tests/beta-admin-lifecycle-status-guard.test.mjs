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
  assert.match(adminApi, /nextRank < currentRank/);
  assert.match(adminApi, /error\.code = 'LIFECYCLE_STATUS_CONFLICT'/);
});

test(
  'email proof and invite delivery milestones cannot be forged manually',
  () => {
    assert.match(
      adminApi,
      /const SYSTEM_OWNED_STATUSES = new Set\(\['verified', 'invited'\]\)/
    );
    assert.match(
      adminApi,
      /SYSTEM_OWNED_STATUSES\.has\(status\) && status !== current\.status/
    );
    assert.doesNotMatch(adminApi, /patch\.email_verified\s*=\s*true/);
    assert.doesNotMatch(adminApi, /patch\.invite_sent_at\s*=/);
    assert.match(
      adminApi,
      /patch\.registered_at = current\.registered_at \|\| now/
    );
    assert.match(
      adminApi,
      /patch\.first_novel_at = current\.first_novel_at \|\| now/
    );
  }
);

test(
  'beta admin keeps cancellation outside lifecycle rank and preserves milestone history',
  () => {
    const rankBlock = adminApi.match(
      /const LIFECYCLE_STATUS_RANK = new Map\(\[([\s\S]*?)\]\);/
    )?.[1];
    assert.ok(rankBlock);
    assert.doesNotMatch(rankBlock, /cancelled/);
    assert.doesNotMatch(adminApi, /patch\.invite_sent_at\s*=\s*null/);
    assert.doesNotMatch(adminApi, /patch\.registered_at\s*=\s*null/);
    assert.doesNotMatch(adminApi, /patch\.first_novel_at\s*=\s*null/);
    assert.doesNotMatch(adminApi, /patch\.email_verified\s*=\s*false/);
  }
);

test(
  'beta admin UI permanently disables system-owned lifecycle choices',
  () => {
    assert.match(
      adminHtml,
      /const lifecycleStatusRank=\{preregistered:0,verified:1,invited:2,registered:3,first_novel:4\}/
    );
    assert.match(adminHtml, /function configureStatusOptions\(current\)/);
    assert.match(
      adminHtml,
      /const systemOwned=option\.value==='verified'\|\|option\.value==='invited'/
    );
    assert.match(
      adminHtml,
      /option\.disabled=systemOwned\|\|\(Number\.isInteger\(optionRank\)/
    );
    assert.match(adminHtml, /メール確認済み（自動）/);
    assert.match(adminHtml, /招待メール送信済み（自動）/);
  }
);
