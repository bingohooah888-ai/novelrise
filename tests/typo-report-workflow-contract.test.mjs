import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const files = {
  migration: new URL(
    '../supabase/migrations/20260918080000_typo_report_workflow.sql',
    import.meta.url
  ),
  precheck: new URL(
    '../supabase/checks/20260918080000_typo_report_workflow_precheck.sql',
    import.meta.url
  ),
  postcheck: new URL(
    '../supabase/checks/20260918080000_typo_report_workflow_postcheck.sql',
    import.meta.url
  ),
  rollback: new URL(
    '../supabase/rollback/20260918080000_typo_report_workflow_rollback.sql',
    import.meta.url
  ),
  reader: new URL('../novelight-typo-reader.js', import.meta.url),
  shared: new URL('../novelight-typo-reports.js', import.meta.url),
  episode: new URL('../episode.html', import.meta.url),
  episodeEdit: new URL('../episode-edit.html', import.meta.url),
  novelEdit: new URL('../novel-edit.html', import.meta.url)
};

const read = key => readFile(files[key], 'utf8');

test('typo reports are private, bounded, and author-reviewed', async () => {
  const migration = await read('migration');

  assert.match(migration, /create table public\.episode_typo_reports/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on table public\.episode_typo_reports from public, anon, authenticated/i
  );
  assert.match(migration, /source_length between 1 and 500/i);
  assert.match(migration, /char_length\(replacement_text\) <= 500/i);
  assert.match(migration, /TYPO_REPORT_RATE_LIMIT/);
  assert.match(migration, /TYPO_REPORT_EPISODE_LIMIT/);
  assert.match(migration, /TYPO_REPORT_DUPLICATE/);
  assert.match(migration, /user_blocks/i);
  assert.match(migration, /DIRECT_INTERACTION_UNAVAILABLE/);
  assert.match(migration, /Authors cannot submit typo reports to their own episode/i);
});

test('safe apply validates the exact source and records typo_apply revision reason', async () => {
  const migration = await read('migration');

  assert.match(
    migration,
    /substring\(v_episode\.content from v_report\.source_start for v_report\.source_length\)[\s\S]*?v_report\.original_text/i
  );
  assert.match(migration, /overlay\([\s\S]*?v_report\.replacement_text/i);
  assert.match(
    migration,
    /set_config\('novelight\.revision_reason', 'typo_apply', true\)/i
  );
  assert.match(
    migration,
    /update public\.episode_typo_reports[\s\S]*?status = 'applied'[\s\S]*?update public\.episodes/i
  );
  assert.match(migration, /episode_typo_reports_after_content_update/i);
  assert.match(
    migration,
    /where episode_id = new\.id[\s\S]*?and status = 'pending'/i
  );
});

test('typo report RPC surface is authenticated only and internal trigger is not executable', async () => {
  const migration = await read('migration');
  const postcheck = await read('postcheck');

  for (const fn of [
    'novelight_submit_episode_typo_report',
    'novelight_list_episode_typo_reports',
    'novelight_apply_episode_typo_report',
    'novelight_reject_episode_typo_report'
  ]) {
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`, 'i'));
  }

  assert.match(
    migration,
    /grant execute on function public\.novelight_submit_episode_typo_report\(bigint, integer, text, text\) to authenticated, service_role/i
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_stale_episode_typo_reports\(\) from public, anon, authenticated, service_role/i
  );
  assert.match(postcheck, /Anonymous typo-report RPC access exists/i);
  assert.match(postcheck, /Internal stale trigger function must not be client\/server RPC surface/i);
});

test('reader flow requires a selected body range and never auto-applies', async () => {
  const [reader, shared, episode] = await Promise.all([
    read('reader'),
    read('shared'),
    read('episode')
  ]);

  assert.match(episode, /novelight-typo-reports\.js/);
  assert.match(episode, /novelight-typo-reader\.js/);
  assert.match(shared, /captureSelection/);
  assert.match(shared, /selection\.isCollapsed/);
  assert.match(shared, /sourceStart/);
  assert.match(reader, /novelight_submit_episode_typo_report/);
  assert.match(reader, /本文には自動反映されません/);
  assert.doesNotMatch(reader, /novelight_apply_episode_typo_report/);
  assert.doesNotMatch(reader, /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|eval\(|new Function/);
});

test('author review UI exposes explicit apply and reject only', async () => {
  const [shared, edit] = await Promise.all([read('shared'), read('episodeEdit')]);

  assert.match(edit, /id="typoReportsPanel"/);
  assert.match(edit, /novelight-typo-reports\.js/);
  assert.match(shared, /novelight_list_episode_typo_reports/);
  assert.match(shared, /novelight_apply_episode_typo_report/);
  assert.match(shared, /novelight_reject_episode_typo_report/);
  assert.match(shared, /採用して本文に反映/);
  assert.match(shared, /改稿履歴へ保存されます/);
  assert.match(shared, /\.textContent\s*=/);
  assert.doesNotMatch(shared, /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|eval\(|new Function/);
});

test('per-work receive toggle is migration-compatible before schema rollout', async () => {
  const novelEdit = await read('novelEdit');

  assert.match(novelEdit, /id="typoReportsEnabled"/);
  assert.match(novelEdit, /typoSettingAvailable/);
  assert.match(
    novelEdit,
    /Object\.prototype\.hasOwnProperty\.call\(data,'typo_reports_enabled'\)/
  );
  assert.match(
    novelEdit,
    /if\(typoSettingAvailable\)payload\.typo_reports_enabled=/
  );
});

test('migration has precheck, postcheck, and guarded non-lossy rollback', async () => {
  const [precheck, postcheck, rollback] = await Promise.all([
    read('precheck'),
    read('postcheck'),
    read('rollback')
  ]);

  assert.match(precheck, /episode_revisions/i);
  assert.match(precheck, /Revision history does not recognize typo_apply/i);
  assert.match(postcheck, /Typo-report rows must not be directly accessible to clients/i);
  assert.match(rollback, /Refusing lossy rollback while typo reports exist/i);
  assert.match(
    rollback,
    /Refusing lossy rollback while an author has disabled typo reports/i
  );
  assert.doesNotMatch(rollback, /drop table public\.episodes/i);
  assert.doesNotMatch(rollback, /drop table public\.novels/i);
});
