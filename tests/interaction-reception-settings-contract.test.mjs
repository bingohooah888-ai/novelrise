import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918164000_interaction_reception_settings.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918164000_interaction_reception_settings_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918164000_interaction_reception_settings_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918164000_interaction_reception_settings_rollback.sql',
  'utf8'
);
const settingsPage = await readFile('interaction-settings.html', 'utf8');
const commentsRuntime = await readFile('novelight-comments.js', 'utf8');
const typoPage = await readFile('typo-reports.html', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const myNovelsPage = await readFile('my-novels.html', 'utf8');

test('B #11 keeps comment preferences private and reuses live typo settings', () => {
  assert.match(migration, /create table public\.author_interaction_defaults/iu);
  assert.match(
    migration,
    /create table public\.novel_comment_reception_settings/iu
  );
  assert.doesNotMatch(
    migration,
    /create table public\.novel_interaction_settings/iu
  );
  assert.match(
    migration,
    /alter table public\.novel_typo_report_settings[\s\S]*add column inherits_author_default/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.author_interaction_defaults from public, anon, authenticated/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_comment_reception_settings from public, anon, authenticated/iu
  );
});

test('author defaults and per-work overrides expose only bounded RPCs', () => {
  for (const fn of [
    'novelight_author_interaction_defaults',
    'novelight_set_author_interaction_defaults',
    'novelight_author_novel_interaction_settings',
    'novelight_set_novel_interaction_settings'
  ]) {
    assert.match(migration, new RegExp(`create function public\\.${fn}`, 'iu'));
  }
  assert.match(
    migration,
    /grant execute on function public\.novelight_author_interaction_defaults\(\)[\s\S]*to authenticated, service_role/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_novel_comment_reception_state\(bigint\)[\s\S]*to anon, authenticated, service_role/iu
  );
});

test('comment reception is enforced before comment and SCOUT evidence can be written', () => {
  assert.match(
    migration,
    /create trigger novelight_enforce_comment_reception/iu
  );
  assert.match(migration, /before insert on public\.novel_comments/iu);
  assert.match(migration, /message = 'COMMENTS_DISABLED'/u);
  assert.match(commentsRuntime, /novelight_novel_comment_reception_state/u);
  assert.match(commentsRuntime, /message\.includes\('COMMENTS_DISABLED'\)/u);
  assert.match(
    commentsRuntime,
    /過去のコメントは(?:引き続き確認|閲覧)できます/u
  );
});

test('comment reader UI is rolling-deploy safe and fails closed on unexpected state errors', () => {
  assert.match(commentsRuntime, /error\?\.code === 'PGRST202'/u);
  assert.match(
    commentsRuntime,
    /return \{ commentsEnabled: true, unavailable: false, fallback: true \}/u
  );
  assert.match(
    commentsRuntime,
    /return \{ commentsEnabled: false, unavailable: true, fallback: false \}/u
  );
  assert.match(
    commentsRuntime,
    /コメント受付状態を確認できないため、現在投稿できません/u
  );
});

test('live typo reception can inherit author defaults without losing explicit per-work control', () => {
  assert.match(
    migration,
    /create trigger novelight_seed_typo_reception_for_novel[\s\S]*after insert on public\.novels/iu
  );
  assert.match(migration, /inherits_author_default = true/iu);
  assert.match(
    migration,
    /create or replace function public\.novelight_set_novel_typo_reports_enabled/iu
  );
  assert.match(migration, /inherits_author_default[\s\S]*false/iu);
  assert.match(typoPage, /作者デフォルトへ戻す場合は「交流設定」を使います/u);
});

test('author UI provides defaults, inheritance, and current-work entry points', () => {
  assert.match(settingsPage, /作者の既定値/u);
  assert.match(settingsPage, /作者の既定値を使う/u);
  assert.match(settingsPage, /コメントを受け付ける/u);
  assert.match(settingsPage, /誤字報告を受け付ける/u);
  assert.match(settingsPage, /novelight_set_author_interaction_defaults/u);
  assert.match(settingsPage, /novelight_set_novel_interaction_settings/u);
  assert.match(myNovelsPage, /interaction-settings\.html\?novel_id=/u);
  assert.match(novelPage, /id="manageInteractions"/u);
  assert.match(novelPage, /interaction-settings\.html\?novel_id=/u);
});

test('interaction preferences remain outside evaluation and exposure systems', () => {
  assert.match(
    migration,
    /must not alter[\s\S]*Rank, LIGHT SEED, SCOUT scoring, PV, favorites, or exposure allocation/iu
  );
  assert.doesNotMatch(
    migration,
    /novelight_recalculate_work_ranks|send_light_seed|novel_exposure_events/iu
  );
  assert.match(
    settingsPage,
    /Rank、LIGHT SEED、Scout XP、PV、お気に入り、露出配分には影響しません/u
  );
});

test('migration ships with precheck, strong postcheck, and guarded rollback', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: B #11 interaction reception prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: B #11 interaction reception is private, inherited, and comment-gated/u
  );
  assert.match(postcheck, /has_table_privilege/iu);
  assert.match(postcheck, /has_function_privilege/iu);
  assert.match(
    rollback,
    /ROLLBACK REFUSED: author interaction defaults contain user data/u
  );
  assert.match(
    rollback,
    /ROLLBACK REFUSED: per-work comment reception settings contain user data/u
  );
});
