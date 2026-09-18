import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918112000_typo_report_review.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918112000_typo_report_review_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918112000_typo_report_review_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918112000_typo_report_review_rollback.sql',
  'utf8'
);
const episodePage = await readFile('episode.html', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const managerPage = await readFile('typo-reports.html', 'utf8');
const revisionMigration = await readFile(
  'supabase/migrations/20260917074632_episode_revision_history.sql',
  'utf8'
);

test('typo report storage is private, RLS-enabled, and reception is opt-in', () => {
  assert.match(migration, /create table public\.novel_typo_report_settings/i);
  assert.match(migration, /enabled boolean not null default false/i);
  assert.match(migration, /create table public\.episode_typo_reports/i);
  assert.match(
    migration,
    /alter table public\.novel_typo_report_settings enable row level security/i
  );
  assert.match(
    migration,
    /alter table public\.episode_typo_reports enable row level security/i
  );
  assert.match(
    migration,
    /revoke all on table public\.episode_typo_reports from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /revoke all on table public\.novel_typo_report_settings from public, anon, authenticated/i
  );
});

test('reader submission is authenticated, bounded, block-aware, and exact-source only', () => {
  assert.match(
    migration,
    /create function public\.novelight_submit_typo_report\([\s\S]*security definer[\s\S]*set search_path = ''/i
  );
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/i);
  assert.match(migration, /Authors cannot report their own episode/i);
  assert.match(migration, /TYPO_REPORTS_DISABLED/i);
  assert.match(migration, /DIRECT_INTERACTION_UNAVAILABLE/i);
  assert.match(migration, /interval '1 hour'/i);
  assert.match(migration, />= 10/i);
  assert.match(migration, /interval '1 day'/i);
  assert.match(migration, />= 50/i);
  assert.match(migration, /TYPO_REPORT_EPISODE_LIMIT/i);
  assert.match(migration, /TYPO_REPORT_NOVEL_LIMIT/i);
  assert.match(migration, /TYPO_REPORT_SOURCE_NOT_FOUND/i);
  assert.match(migration, /TYPO_REPORT_SOURCE_NOT_UNIQUE/i);
  assert.match(migration, /TYPO_REPORT_DUPLICATE/i);
  assert.match(
    migration,
    /episode_typo_reports_pending_duplicate_idx[\s\S]*where status = 'pending'/i
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_submit_typo_report\(bigint, text, text\) from public, anon, authenticated, service_role/i
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_submit_typo_report\(bigint, text, text\) to authenticated, service_role/i
  );
});

test('author review never exposes reporter identity and never auto-applies', () => {
  const listFunction =
    migration.match(
      /create function public\.novelight_author_typo_reports[\s\S]*?\n\$\$;/i
    )?.[0] ?? '';
  assert.ok(listFunction);
  assert.doesNotMatch(listFunction, /reporter_id[\s\S]*returns table/i);
  assert.match(listFunction, /r\.author_id = v_uid/i);
  assert.match(managerPage, /この修正を採用/);
  assert.match(managerPage, /却下/);
  assert.match(managerPage, /window\.confirm/);
  assert.doesNotMatch(managerPage, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(managerPage, /\.textContent\s*=/);
});

test('accepted suggestions use exact-offset stale protection and revision history', () => {
  const applyFunction =
    migration.match(
      /create function public\.novelight_apply_typo_report[\s\S]*?\n\$\$;/i
    )?.[0] ?? '';
  assert.ok(applyFunction);
  assert.match(applyFunction, /for update/i);
  assert.match(applyFunction, /v_report\.source_start \+ 1/i);
  assert.match(applyFunction, /v_current_source is distinct from v_report\.source_text/i);
  assert.match(applyFunction, /status = 'stale'/i);
  assert.match(
    applyFunction,
    /set_config\('novelight\.revision_reason', 'typo_apply', true\)/i
  );
  const episodeUpdate =
    applyFunction.match(
      /update public\.episodes e\s+set[\s\S]*?where e\.id = v_report\.episode_id\s+and e\.user_id = v_uid;/i
    )?.[0] ?? '';
  const episodeSet = episodeUpdate.match(/set[\s\S]*?where/i)?.[0] ?? '';
  assert.ok(episodeUpdate);
  assert.match(episodeSet, /set content =/i);
  assert.doesNotMatch(
    episodeSet,
    /episode_number\s*=|status\s*=|pv\s*=|novel_id\s*=|user_id\s*=/i
  );
  assert.match(revisionMigration, /'typo_apply'/i);
  assert.match(revisionMigration, /before update of title, content/i);
});

test('reader UI keeps moderation reports separate and fails closed before migration', () => {
  assert.match(episodePage, /id="typoReport"/);
  assert.match(episodePage, /novelight_typo_report_state/);
  assert.match(episodePage, /novelight_submit_typo_report/);
  assert.match(episodePage, /typoRuntimeMissing/);
  assert.match(episodePage, /PGRST202/);
  assert.match(episodePage, /誤字・脱字を作者へ報告/);
  assert.match(episodePage, /エピソードを通報/);
  assert.doesNotMatch(episodePage, /from\(['"]episode_typo_reports['"]\)/);
});

test('author work page links to a dedicated review surface', () => {
  assert.match(novelPage, /id="manageTypos"/);
  assert.match(novelPage, /typo-reports\.html\?novel_id=/);
  assert.match(managerPage, /novelight_author_typo_report_settings/);
  assert.match(managerPage, /novelight_set_novel_typo_reports_enabled/);
  assert.match(managerPage, /novelight_author_typo_reports/);
  assert.match(managerPage, /novelight_apply_typo_report/);
  assert.match(managerPage, /novelight_reject_typo_report/);
  assert.doesNotMatch(managerPage, /from\(['"]episode_typo_reports['"]\)/);
});

test('typo workflow remains independent from evaluation systems', () => {
  const prohibited =
    /novelight_recalculate_work_ranks|plant_light_seed|send_light_seed|record_episode_pv|record_valid_read_progress|novel_rank_state|scout_xp/i;
  assert.doesNotMatch(migration, prohibited);
  assert.doesNotMatch(managerPage, prohibited);
});

test('migration ships precheck, postcheck, and destructive rollback guard', () => {
  assert.match(precheck, /PRECHECK PASS/);
  assert.match(precheck, /episode_revision_history_before_update/);
  assert.match(precheck, /typo_apply/);
  assert.match(postcheck, /POSTCHECK PASS/);
  assert.match(postcheck, /raw typo report tables are client-accessible/i);
  assert.match(postcheck, /anonymous typo mutation\/review access exists/i);
  assert.match(postcheck, /search_path=""/i);
  assert.match(rollback, /ROLLBACK REFUSED: typo report records exist/i);
  assert.match(
    rollback,
    /ROLLBACK REFUSED: author typo reception settings exist/i
  );
  assert.doesNotMatch(rollback, /drop table if exists public\.episodes\b/i);
  assert.doesNotMatch(rollback, /drop table if exists public\.novels\b/i);
});
