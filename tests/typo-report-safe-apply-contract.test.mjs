import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918080000_typo_report_safe_apply.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918080000_typo_report_safe_apply_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918080000_typo_report_safe_apply_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918080000_typo_report_safe_apply_rollback.sql',
  'utf8'
);
const readerClient = await readFile('novelight-typo-reports.js', 'utf8');
const authorPage = await readFile('typo-reports.html', 'utf8');
const episodePage = await readFile('episode.html', 'utf8');
const myNovels = await readFile('my-novels.html', 'utf8');

test('typo reports are private workflow data with RLS and no raw client access', () => {
  assert.match(migration, /create table public\.episode_typo_reports/);
  assert.match(migration, /alter table public\.episode_typo_reports enable row level security/);
  assert.match(
    migration,
    /revoke all on table public\.episode_typo_reports from public, anon, authenticated/
  );
  assert.match(
    migration,
    /status text not null default 'pending'[\s\S]*'accepted'[\s\S]*'rejected'[\s\S]*'stale'/
  );
});

test('author typo reception defaults to off and supports per-work inheritance', () => {
  assert.match(migration, /create table public\.author_interaction_defaults/);
  assert.match(migration, /typo_reports_enabled boolean not null default false/);
  assert.match(migration, /create table public\.novel_interaction_settings/);
  assert.match(
    migration,
    /create function public\.novelight_author_typo_report_defaults\(\)/
  );
  assert.match(
    migration,
    /create function public\.novelight_set_novel_typo_report_settings/
  );
  assert.match(authorPage, /初期状態はOFFです/);
  assert.match(authorPage, /作者の既定値を使う/);
});

test('reader submission validates an exact current text span and applies abuse bounds', () => {
  assert.match(
    migration,
    /substring\(v_content from p_start_char for char_length\(v_original\)\) <> v_original/
  );
  assert.match(migration, /v_hash := md5\(v_content\)/);
  assert.match(migration, /v_count >= 12/);
  assert.match(migration, /v_count >= 4/);
  assert.match(migration, /v_count >= 200/);
  assert.match(migration, /v_count >= 30/);
  assert.match(
    migration,
    /create unique index episode_typo_reports_pending_duplicate_idx/
  );
  assert.match(migration, /Authors cannot submit typo reports to their own episode/);
  assert.match(migration, /TYPO_REPORTS_DISABLED/);
});

test('reader selection records Unicode-safe character position and never edits episode content', () => {
  assert.match(readerClient, /Array\.from\(String\(value \|\| ''\)\)\.length/);
  assert.match(readerClient, /prefixRange\.setEnd/);
  assert.match(readerClient, /novelight_submit_typo_report/);
  assert.match(readerClient, /本文は自動では変更されず/);
  assert.doesNotMatch(readerClient, /\.from\(['"]episodes['"]\)\.update/);
  assert.match(episodePage, /novelight-typo-reports\.js/);
  assert.match(episodePage, /NovelightTypoReports\.mount/);
});

test('author accept is explicit, stale-safe, and reuses revision history with typo_apply', () => {
  assert.match(
    migration,
    /create function public\.novelight_resolve_typo_report/
  );
  assert.match(migration, /v_action not in \('accept', 'reject'\)/);
  assert.match(
    migration,
    /md5\(v_content\) <> v_report\.base_content_hash/
  );
  assert.match(
    migration,
    /substring\([\s\S]*v_report\.start_char[\s\S]*v_report\.original_text[\s\S]*<> v_report\.original_text/
  );
  assert.match(
    migration,
    /set_config\('novelight\.revision_reason', 'typo_apply', true\)/
  );
  assert.match(migration, /v_new_content := overlay\(/);
  assert.match(
    migration,
    /update public\.episodes e[\s\S]*set content = v_new_content/
  );
  assert.match(authorPage, /採用して本文へ反映/);
  assert.match(authorPage, /本文が報告後に変更されています/);
  assert.match(authorPage, /変更前本文は改稿履歴へ保存されています/);
});

test('safe apply changes prose only and remains outside evaluation systems', () => {
  const resolveStart = migration.indexOf(
    'create function public.novelight_resolve_typo_report'
  );
  const resolveEnd = migration.indexOf(
    'revoke all on function public.novelight_author_typo_report_defaults'
  );
  const resolveBody = migration.slice(resolveStart, resolveEnd);
  assert.match(resolveBody, /set content = v_new_content/);
  assert.doesNotMatch(resolveBody, /episode_number\s*=/);
  assert.doesNotMatch(resolveBody, /status\s*=\s*v_/);
  assert.doesNotMatch(
    migration,
    /novelight_recalculate_work_ranks|plant_light_seed|record_episode_pv|favorites|exposure_allocation/
  );
});

test('author workflow exposes reports without reporter identity and links from work management', () => {
  assert.match(migration, /create function public\.novelight_list_author_typo_reports/);
  assert.match(authorPage, /novelight_list_author_typo_reports/);
  assert.match(authorPage, /修正前/);
  assert.match(authorPage, /修正案/);
  assert.match(authorPage, /見送る/);
  assert.doesNotMatch(authorPage, /reporter_id|display_name.*reporter/);
  assert.match(myNovels, /typo-reports\.html\?novel_id=/);
});

test('migration requires existing revision safety and ships precheck, postcheck, guarded rollback', () => {
  assert.match(precheck, /episode_revision_history_before_update/);
  assert.match(precheck, /typo_apply/);
  assert.match(precheck, /PRECHECK PASS/);
  assert.match(postcheck, /POSTCHECK PASS/);
  assert.match(postcheck, /Raw typo-report tables must not be client-readable/);
  assert.match(
    rollback,
    /Refusing lossy rollback while typo reports or author preferences exist/
  );
  assert.match(rollback, /drop table public\.episode_typo_reports/);
});
