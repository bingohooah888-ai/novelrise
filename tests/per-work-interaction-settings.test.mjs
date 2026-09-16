import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260917060000_interaction_settings.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260917060000_interaction_settings_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260917060000_interaction_settings_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260917060000_interaction_settings_rollback.sql',
  'utf8'
);
const settingsPage = await readFile('interaction-settings.html', 'utf8');
const commentsClient = await readFile('novelight-comments.js', 'utf8');
const authorShell = await readFile('novelight-author-studio-shell.js', 'utf8');
const myNovels = await readFile('my-novels.html', 'utf8');

test('interaction settings migration keeps raw preferences private and owner-controlled', () => {
  assert.match(migration, /create table public\.author_interaction_defaults/);
  assert.match(migration, /create table public\.novel_interaction_settings/);
  assert.match(
    migration,
    /alter table public\.author_interaction_defaults enable row level security/
  );
  assert.match(
    migration,
    /alter table public\.novel_interaction_settings enable row level security/
  );
  assert.match(
    migration,
    /revoke all on table public\.author_interaction_defaults from public, anon, authenticated/
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_interaction_settings from public, anon, authenticated/
  );
  assert.match(migration, /set search_path = ''/);
});

test('author defaults and per-work overrides are exposed only through bounded RPCs', () => {
  assert.match(
    migration,
    /create function public\.novelight_author_interaction_defaults\(\)/
  );
  assert.match(
    migration,
    /create function public\.novelight_set_author_interaction_defaults/
  );
  assert.match(
    migration,
    /create function public\.novelight_author_novel_interaction_settings/
  );
  assert.match(
    migration,
    /create function public\.novelight_set_novel_interaction_settings/
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_author_interaction_defaults\(\) to authenticated/
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_author_interaction_defaults\(\) from public, anon/
  );
});

test('comment reception is enforced at the database write boundary', () => {
  assert.match(
    migration,
    /create function public\._novelight_enforce_comment_reception\(\)/
  );
  assert.match(
    migration,
    /create trigger novelight_enforce_comment_reception[\s\S]*before insert on public\.novel_comments/
  );
  assert.match(migration, /message = 'COMMENTS_DISABLED'/);
  assert.match(commentsClient, /message\.includes\('COMMENTS_DISABLED'\)/);
  assert.match(
    commentsClient,
    /この作品では現在コメントを受け付けていません。過去のコメントは閲覧できます。/
  );
});

test('reader presentation has phased-deploy fallback without bypassing DB enforcement', () => {
  assert.match(
    commentsClient,
    /rpc\('novelight_novel_interaction_state'/
  );
  assert.match(commentsClient, /error\?\.code === '42883'/);
  assert.match(
    commentsClient,
    /return \{ commentsEnabled: true, fallback: true \}/
  );
  assert.match(commentsClient, /rpc\('post_novel_comment'/);
  assert.doesNotMatch(commentsClient, /\.from\(['"]novel_comments['"]\)/);
});

test('typo-report preference is stored but no reader report action is exposed yet', () => {
  assert.match(migration, /'typo_reports_live', false/);
  assert.match(settingsPage, /誤字報告機能は準備中です/);
  assert.doesNotMatch(commentsClient, /post_typo|submit_typo|typo-report|誤字報告/);
});

test('author studio exposes defaults and per-work inheritance controls', () => {
  assert.match(settingsPage, /novelight_author_interaction_defaults/);
  assert.match(settingsPage, /novelight_set_author_interaction_defaults/);
  assert.match(settingsPage, /novelight_author_novel_interaction_settings/);
  assert.match(settingsPage, /novelight_set_novel_interaction_settings/);
  assert.match(settingsPage, /作者の既定値を使う/);
  assert.match(authorShell, /interaction-settings\.html/);
  assert.match(myNovels, /interaction-settings\.html\?novel_id=/);
});

test('interaction controls remain separate from evaluation and exposure systems', () => {
  assert.match(
    migration,
    /must never alter[\s\S]*Rank, LIGHT SEED, SCOUT scoring, PV, favorites, or exposure allocation/
  );
  assert.match(
    settingsPage,
    /Rank、LIGHT SEED、SCOUT EXP、PV、お気に入り、露出配分には影響しません/
  );
  assert.doesNotMatch(
    settingsPage,
    /novelight_recalculate_work_ranks|record_valid_read_progress|send_light_seed/
  );
});

test('migration ships with read-only checks and a scoped rollback', () => {
  assert.match(precheck, /PRECHECK PASS/);
  assert.match(postcheck, /POSTCHECK PASS/);
  assert.match(postcheck, /has_table_privilege/);
  assert.match(postcheck, /has_function_privilege/);
  assert.match(rollback, /drop trigger if exists novelight_enforce_comment_reception/);
  assert.match(rollback, /drop table if exists public\.novel_interaction_settings/);
  assert.match(rollback, /drop table if exists public\.author_interaction_defaults/);
});
