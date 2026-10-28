import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Phase 2 only initializes with both site release flags enabled', () => {
  const shared = read('novelight-client.js');
  assert.match(shared, /timeline:\s*true/);
  assert.match(shared, /board:\s*true/);
  const script = read('novelight-community-board.js');
  assert.match(script, /if \(!flags\.timeline \|\| !flags\.board/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotThrow(() => new Function(script));
});

test('board uses shared plaza page, timeline UI and responsive layer', () => {
  const html = read('community.html');
  for (const id of [
    'communityTimeline',
    'communityBoardInfo',
    'communityPending',
    'boardThreadList',
    'boardComposeForm',
    'boardThreadDetail',
    'boardReplyList',
    'boardReplyForm'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /novelight-community-board\.js/);
  assert.match(html, /novelight-community-board\.css/);
  assert.match(html, /id="communityTimeline" aria-label="タイムライン" hidden/);
  assert.match(html, /id="communityTabs"[^>]+ hidden>/);
  assert.match(html, /id="communityPending"[^>]+role="status">/);
  const css = read('novelight-community-board.css');
  assert.match(css, /#communityTimeline\[hidden\]/);
  assert.match(css, /#communityTabs\[hidden\]/);
  const boardJs = read('novelight-community-board.js');
  assert.ok(boardJs.includes("'community.html#board-thread-'"));

  assert.ok(html.includes('NOVELIGHT_BOARD_INITIAL_THREAD'));
  const notices = read('novelight-community-alerts.js');
  assert.ok(notices.includes('board-thread-'));
  assert.ok(notices.includes('board:'));
  assert.ok(read('novelight-community.js').includes('!flags.board'));
  assert.ok(notices.includes('board !== true'));
  assert.match(read('novelight-client.js'), /board:\s*true/u);
  assert.match(
    read('shared/header/public-header.html'),
    /href="community\.html"/u
  );
  assert.match(html, /交流広場を読み込んでいます/);
});

test('board schema protects private data and release gate', () => {
  const sql = read('docs/community/phase2-board-schema-review.sql');
  assert.match(sql, /REVIEW-ONLY/);
  assert.match(
    sql,
    /ALTER TABLE public\.community_board_threads ENABLE ROW LEVEL SECURITY/
  );
  assert.match(
    sql,
    /REVOKE ALL ON public\.community_board_threads FROM PUBLIC,anon,authenticated/
  );
  assert.doesNotMatch(
    sql,
    /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON public\.community_board_threads/
  );
  for (const rpc of [
    'board_visible',
    'board_list',
    'board_detail',
    'board_save',
    'board_delete'
  ]) {
    const expected = 'CREATE OR REPLACE FUNCTION public\\.novelight_community_';
    assert.match(sql, new RegExp(expected + rpc));
  }
  assert.match(sql, /community_runtime_control/);
  assert.match(sql, /community_user_restrictions/);
  assert.match(sql, /user_blocks/);
  assert.match(sql, /user_mutes/);
  assert.match(sql, /community_hidden_posts/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION /g) || []).length, 9);
  assert.equal((sql.match(/\$\$;/g) || []).length, 9);
  assert.doesNotMatch(
    sql,
    /(?:scout_xp|novelight_ranking_feed|novel_view_events)/i
  );
});

test('board actions reuse existing comment and moderation records', () => {
  const sql = read('docs/community/phase2-board-schema-review.sql');
  const board = read('novelight-community-board.js');
  const admin = read('api/_lib/admin-community.js');
  assert.ok(sql.includes("WHEN p_key ~ '^board:"));
  assert.match(sql, /novelight_community_post_author/);
  assert.match(sql, /novelight_community_interaction_allowed/);
  assert.match(sql, /novelight_admin_community_moderate/);
  assert.match(admin, /board:\[0-9a-f\]\{8\}/);
  for (const name of [
    'novelight_community_comments',
    'novelight_community_post_comment',
    'novelight_community_report',
    'novelight_community_report_comment',
    'novelight_community_edit_my_comment',
    'novelight_community_delete_my_comment'
  ]) {
    assert.ok(board.includes(name), name + ' is reused');
  }
});

test('opt-in author and reader surfaces respect the joint gate', () => {
  for (const page of [
    'author-notes.html',
    'curation-lists.html',
    'light-seed-history.html'
  ]) {
    const html = read(page);
    assert.ok(html.includes('NOVELIGHT_COMMUNITY_FLAGS?.timeline===true'));
    assert.ok(html.includes('NOVELIGHT_COMMUNITY_FLAGS?.board===true'));
  }
});

test('CLI-generated migration and guarded rollback match reviewed SQL', () => {
  const migration = read(
    'supabase/migrations/20261023055617_community_plaza_phase2_board.sql'
  );
  const reviewedMigration = read(
    'docs/community/phase2-board-schema-review.sql'
  );
  assert.equal(migration, reviewedMigration);
  const rollback = read(
    'supabase/rollback/20261023055617_community_plaza_phase2_board_rollback.sql'
  );
  const reviewedRollback = read(
    'docs/community/phase2-board-rollback-review.sql'
  );
  assert.equal(rollback, reviewedRollback);
  assert.match(
    rollback,
    /Board-related records exist; refuse destructive rollback/
  );
  assert.doesNotMatch(rollback, /DROP TABLE .* CASCADE/);
  const pre = read(
    'supabase/checks/20261023055617_community_plaza_phase2_precheck.sql'
  );
  const post = read(
    'supabase/checks/20261023055617_community_plaza_phase2_postcheck.sql'
  );
  assert.match(pre, /community_runtime_control/);
  assert.match(post, /community_board_threads/);
});
