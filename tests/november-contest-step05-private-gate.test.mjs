import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/checks/20261015_november_contest_private_prelaunch.sql',
    import.meta.url
  ),
  'utf8'
);
const review = readFileSync(
  new URL(
    '../docs/reports/NOVEMBER-CONTEST-STEP05-PRIVATE-LAUNCH-GATE-20261015.md',
    import.meta.url
  ),
  'utf8'
);

test('step05 private prelaunch cannot publish the contest', () => {
  assert.match(sql, /\\set ON_ERROR_STOP on/);
  assert.match(sql, /begin transaction read only;/i);
  assert.match(sql, /rollback;/i);
  for (const line of sql.replace(/--[^\n]*/g, '').split('\n')) {
    const statement = line.trimStart();
    assert.doesNotMatch(statement, /^(update|insert|delete|truncate|create|drop|alter)\s/i);
    assert.doesNotMatch(statement, /^(grant|revoke|commit|call|execute)\s/i);
  }
  assert.match(sql, /status <> 'draft'/);
  assert.match(sql, /public_visible is not false/);
  assert.match(sql, /terms_version <> ''/);
  assert.match(sql, /terms_url <> ''/);
  assert.match(sql, /contest_unavailable/);
  assert.match(sql, /STEP05_PRELAUNCH_BLOCKED/);
});

test('step05 private check binds dates and entry roles', () => {
  assert.match(sql, /novelight-november-2026/);
  assert.match(sql, /2026-10-31 14:59:59\.999999\+00/);
  assert.match(sql, /2026-10-31 15:00:00\+00/);
  assert.match(sql, /2026-11-30 15:00:00\+00/);
  assert.match(sql, /v_entries <> 0/);
  assert.match(sql, /'anon'/);
  assert.match(sql, /'authenticated'/);
  assert.match(sql, /public\.novelight_public_contest_catalog\(1,0\)/);
});

test('step05 readiness doc does not approve launch', () => {
  assert.match(review, /受付開始承認/);
  assert.match(review, /一般公開・応募受付・DB更新を伴わない/);
  assert.match(review, /正式募集要項ではない/);
  assert.match(review, /法務|税務/);
  assert.match(review, /原子的/);
  assert.match(review, /11月1日/);
});
