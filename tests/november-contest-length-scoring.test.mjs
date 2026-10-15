import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { contestPageTemplate } from '../api/_lib/contest-template.js';
import { contestTermsTemplate } from '../api/_lib/contest-terms-template.js';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261015120000_november_contest_read_chars_thresholds.sql',
    import.meta.url
  ),
  'utf8'
);
const replay = readFileSync(
  new URL('./rls/november-contest-integration.sql', import.meta.url),
  'utf8'
);
const draft = readFileSync(
  new URL(
    '../docs/reports/NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md',
    import.meta.url
  ),
  'utf8'
);

function pointsFor(count, chars) {
  if (count >= 10 && chars >= 6000) return 5;
  if (count >= 5 && chars >= 3000) return 3;
  if (count >= 3 && chars >= 1500) return 1;
  return 0;
}

test('dual-axis thresholds require both valid episodes and combined body chars', () => {
  const examples = [
    [2, 10000, 0],
    [3, 1499, 0],
    [3, 1500, 1],
    [5, 1499, 0],
    [5, 1500, 1],
    [5, 2999, 1],
    [5, 3000, 3],
    [10, 2999, 1],
    [10, 4000, 3],
    [10, 5999, 3],
    [10, 6000, 5],
    [12, 8000, 5]
  ];
  for (const [episodes, chars, expected] of examples) {
    assert.equal(pointsFor(episodes, chars), expected, String([episodes, chars]));
  }
  for (const [episodes, chars, points] of [
    [10, 6000, 5],
    [5, 3000, 3],
    [3, 1500, 1]
  ]) {
    assert.match(
      sql,
      new RegExp(
        `p_qualified_episode_count >= ${episodes} and p_qualified_body_chars >= ${chars} then ${points}`
      )
    );
  }
  assert.match(sql, /qualified_body_char_count/);
  assert.match(sql, /novelight_contest_reader_scores_brackets_check/);
});

test('only server-snapshotted published episode body length can enter ledger', () => {
  assert.match(sql, /pg_catalog\.char_length\(coalesce\(ep\.content,''\)\)/);
  assert.match(sql, /v_body_chars < 200/);
  assert.match(sql, /e\.body_char_count >= 200/);
  assert.match(sql, /ev\.body_char_count >= 200/);
  assert.match(sql, /body_char_count,evidence_summary/);
  assert.match(sql, /'november-2026-points-v2'/);
  assert.match(sql, /'source','guest_account_link'/);
  assert.match(sql, /e\.body_char_count/);
  assert.match(
    sql,
    /on conflict \(contest_id, reader_id, episode_id_snapshot\) do nothing/
  );
  assert.doesNotMatch(sql, /set points = points \+/i);
});

test('contest reading uses the normal valid-read policy, including short-episode scaling', () => {
  assert.match(sql, /from public\.valid_read_rules where id = 1/);
  assert.match(sql, /v_rule\.short_progress_ratio/);
  assert.match(sql, /v_rule\.normal_progress_ratio/);
  assert.match(sql, /v_rule\.min_short_foreground_seconds/);
  assert.match(sql, /v_rule\.normal_foreground_seconds/);
  assert.match(sql, /v_ratio >= v_progress_required/);
  assert.doesNotMatch(sql, /reading_mode = 'tts' then 45 else 30/);
  assert.match(sql, /v_session\.status <> 'qualified'/);
  assert.match(sql, /v_contest\.public_visible is not true/);
  assert.match(
    sql,
    /raise exception 'Non-empty contest scores require separate safe backfill'/
  );
});

test('rank snapshot reuses dual thresholds rather than old episode-only score', () => {
  assert.match(sql, /novelight_contest_prepare_rank_snapshot/);
  assert.match(sql, /pg_catalog\.sum\(ev\.body_char_count\)/);
  assert.match(sql, /novelight_contest_episode_points\(chapters,body_chars\)/);
  assert.doesNotMatch(sql, /case when chapters >= 10 then 5/);
  assert.match(replay, /novelight_contest_episode_points\(3, 1499\)/);
  assert.match(replay, /novelight_contest_episode_points\(10, 6000\)/);
  assert.match(replay, /body_char_count/);
});

test('terms draft and actual gated HTML present the same count-and-length rules', () => {
  for (const text of [contestPageTemplate, contestTermsTemplate, draft]) {
    for (const fragment of [
      '3話以上',
      '5話以上',
      '10話以上',
      '1,500文字以上',
      '3,000文字以上',
      '6,000文字以上',
      '200文字未満'
    ]) {
      assert.ok(text.includes(fragment), fragment);
    }
  }
  assert.match(contestTermsTemplate, /文字数の不自然な水増し/);
  assert.match(contestTermsTemplate, /無意味な文章の大量投稿/);
  assert.match(contestTermsTemplate, /ポイントの無効化/);
  assert.match(contestTermsTemplate, /参加資格の取り消し/);
});
