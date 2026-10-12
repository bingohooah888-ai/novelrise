import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isContestVisible } from '../api/contest-page.js';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const sql = source(
  '../supabase/migrations/20261012132000_november_contest_public_catalog.sql'
);
const page = source('../api/_lib/contest-template.js');
const js = source('../novelight-contest-page.js');
const css = source('../novelight-contest.css');

test('contest awards and scoring milestones', () => {
  assert.match(page, /11月1日（日）〜30日（月）/);
  assert.match(page, /10月31日（土）23:59/);
  assert.match(page, /10話以上/);
  assert.match(page, /1万円/);
  assert.match(page, /3話以上/);
  assert.match(page, /5話以上/);
  assert.match(page, /10話以上/);
  assert.match(page, /11月7日/);
  assert.match(page, /11月15日/);
  assert.match(page, /11月22日/);
  assert.match(page, /正午12:00/);
  assert.match(page, /同順位/);
});

test('author enrollment uses a shared RPC widget', () => {
  assert.match(page, /src="novelight-contest-entry\.js"/);
  assert.match(page, /src="novelight-contest-page\.js"/);
  assert.match(js, /NovelightContestEntry\.mountContestPage/);
  assert.match(js, /auth\.getSession/);
  assert.match(js, /novelight_public_contest_catalog/);
  assert.doesNotMatch(js, /\.from\('novelight_contest_entries'\)/);
  assert.doesNotMatch(js, /\.from\('novelight_contest_readers'\)/);
});

test('public catalog is read-only and sanitizes work fields', () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /limit v_limit offset p_offset/);
  assert.match(sql, /p_limit not between 1 and 48/);
  assert.match(sql, /e\.status = 'entered'/);
  assert.match(sql, /n\.status = 'published'/);
  assert.match(sql, /ep\.status = 'published'/);
  assert.match(sql, /episodes\.published_count >=/);
  assert.match(sql, /v_contest\.status in/);
  assert.match(sql, /'registration','active','review','finalized'/);
  assert.match(sql, /to anon, authenticated;/);
  assert.doesNotMatch(sql, /\bupdate\s+public\./i);
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\./i);
});

test('public cards contain no reader identifiers or banking details', () => {
  assert.doesNotMatch(sql, /'guest_key_hash'/);
  assert.doesNotMatch(sql, /'author_id'/);
  assert.doesNotMatch(sql, /'reader_id'/);
  assert.doesNotMatch(sql, /'transfer_reference'/);
  assert.doesNotMatch(sql, /'bank_account'/);
  assert.match(js, /title\.textContent/);
  assert.match(js, /chip\.textContent/);
  assert.match(js, /encodeURIComponent\(work\.novel_id\)/);
  assert.doesNotMatch(js, /innerHTML/);
});

test('entry page supports guest browsing, login and small screens', () => {
  assert.match(page, /id="contestEntries"/);
  assert.match(page, /id="contestEnrollment"/);
  assert.match(page, /id="contestLoginPrompt"/);
  assert.match(page, /id="contestMoreButton"/);
  assert.match(js, /async function loadEntries/);
  assert.match(js, /async function loadAuthorEnrollment/);
  assert.match(css, /max-width:820px/);
  assert.match(css, /max-width:560px/);
  assert.match(css, /prefers-reduced-motion/);
});

test('contest URL requires server publication approval', () => {
  assert.equal(existsSync(new URL('../contest.html', import.meta.url)), false);
  const vercel = JSON.parse(source('../vercel.json'));
  for (const route of ['/contest.html', '/contest']) {
    assert.ok(
      vercel.rewrites.some(
        (item) =>
          item.source === route && item.destination === '/api/contest-page'
      )
    );
  }
  const serverPage = source('../api/contest-page.js');
  assert.match(serverPage, /public_visible/);
  assert.match(serverPage, /notFound\(res\)/);
  assert.match(serverPage, /status\(404\)/);
  assert.match(sql, /v_contest\.public_visible is not true/);
});

test('server page denies unpublished or invalid states', () => {
  assert.equal(isContestVisible(null), false);
  assert.equal(
    isContestVisible({ status: 'draft', public_visible: false }),
    false
  );
  assert.equal(
    isContestVisible({ status: 'registration', public_visible: false }),
    false
  );
  assert.equal(
    isContestVisible({ status: 'registration', public_visible: true }),
    true
  );
  assert.equal(
    isContestVisible({ status: 'active', public_visible: true }),
    true
  );
  assert.equal(
    isContestVisible({ status: 'cancelled', public_visible: true }),
    false
  );
});
