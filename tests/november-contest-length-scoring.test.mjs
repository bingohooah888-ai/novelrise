import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { contestPageTemplate } from '../api/_lib/contest-template.js';
import { contestTermsTemplate } from '../api/_lib/contest-terms-template.js';

const migrationPath =
  '../supabase/migrations/20261015120000_november_contest_read_chars_thresholds.sql';
const draftPath =
  '../docs/reports/NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md';
const sql = readFileSync(new URL(migrationPath, import.meta.url), 'utf8');
const draft = readFileSync(new URL(draftPath, import.meta.url), 'utf8');

function pointsFor(count, chars) {
  if (count >= 10 && chars >= 6000) return 5;
  if (count >= 5 && chars >= 3000) return 3;
  if (count >= 3 && chars >= 1500) return 1;
  return 0;
}

test('two thresholds and highest reached bracket', () => {
  assert.equal(pointsFor(2, 99999), 0);
  assert.equal(pointsFor(3, 1499), 0);
  assert.equal(pointsFor(3, 1500), 1);
  assert.equal(pointsFor(5, 2999), 1);
  assert.equal(pointsFor(5, 3000), 3);
  assert.equal(pointsFor(10, 5999), 3);
  assert.equal(pointsFor(10, 6000), 5);
  assert.equal(pointsFor(12, 99999), 5);
  assert.match(sql, /p_qualified_body_chars >= 6000 then 5/);
  assert.match(sql, /p_qualified_body_chars >= 3000 then 3/);
  assert.match(sql, /p_qualified_body_chars >= 1500 then 1/);
});

test('server captures real body text and filters short episodes', () => {
  assert.match(sql, /char_length\(coalesce\(ep\.content,''\)\)/);
  assert.match(sql, /v_body_chars < 200/);
  assert.match(sql, /e\.body_char_count >= 200/);
  assert.match(sql, /ev\.body_char_count >= 200/);
  assert.match(sql, /qualified_body_char_count/);
  assert.match(sql, /'november-2026-points-v2'/);
  assert.match(sql, /'source','guest_account_link'/);
  assert.doesNotMatch(sql, /set points = points \+/i);
});

test('contest uses the shared valid-read rules', () => {
  assert.match(sql, /from public\.valid_read_rules where id = 1/);
  assert.match(sql, /v_rule\.short_progress_ratio/);
  assert.match(sql, /v_rule\.normal_progress_ratio/);
  assert.match(sql, /v_rule\.min_short_foreground_seconds/);
  assert.match(sql, /v_rule\.normal_foreground_seconds/);
  assert.match(sql, /v_ratio >= v_progress_required/);
  assert.doesNotMatch(sql, /reading_mode = 'tts' then 45 else 30/);
  assert.match(sql, /v_contest\.public_visible is not true/);
});

test('rankings apply the same dual thresholds as reader scores', () => {
  assert.match(sql, /novelight_contest_prepare_rank_snapshot/);
  assert.match(sql, /sum\(ev\.body_char_count\)/);
  assert.match(sql, /novelight_contest_episode_points\(chapters,body_chars\)/);
  assert.doesNotMatch(sql, /case when chapters >= 10 then 5/);
});

test('the terms and contest page show all new conditions', () => {
  const sources = [contestPageTemplate, contestTermsTemplate, draft];
  const limits = [
    '3話以上',
    '5話以上',
    '10話以上',
    '1,500文字以上',
    '3,000文字以上',
    '6,000文字以上',
    '200文字未満'
  ];
  for (const source of sources) {
    for (const limit of limits) {
      assert.ok(source.includes(limit), limit);
    }
  }
  assert.match(contestTermsTemplate, /文字数の不自然な水増し/);
  assert.match(contestTermsTemplate, /無意味な文章の大量投稿/);
  assert.match(contestTermsTemplate, /ポイントの無効化/);
  assert.match(contestTermsTemplate, /参加資格の取り消し/);
});
