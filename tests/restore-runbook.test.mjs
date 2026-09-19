import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('restore runbook requires disposable-target automated validation', () => {
  const runbook = read('docs/BACKUP-RESTORE-RUNBOOK.md');
  assert.match(runbook, /Last updated: 2026-09-19/);
  assert.match(runbook, /supabase\/checks\/restore_validation\.sql/);
  assert.match(runbook, /non-production\/disposable target/i);
  assert.match(
    runbook,
    /Never point `RESTORED_DATABASE_URL` at public-beta Production/
  );
  assert.match(runbook, /private author story-planning notes/);
  assert.match(runbook, /Reading progress and bookshelf state remain private/);
  assert.match(runbook, /Block\/Mute state survives restore/);
});

test('restored-target SQL covers current private and fairness-critical data models', () => {
  const sql = read('supabase/checks/restore_validation.sql');
  for (const table of [
    'valid_read_events',
    'reader_reading_progress',
    'reader_bookshelf_entries',
    'user_blocks',
    'episode_revisions',
    'novel_characters',
    'novel_polls',
    'reader_curation_lists',
    'novel_collaborators',
    'novel_private_story_notes'
  ]) {
    assert.match(sql, new RegExp(`'${table}'`), table);
  }

  assert.match(sql, /c\.relrowsecurity/);
  assert.match(sql, /has_table_privilege\('anon'/);
  assert.match(sql, /novel_exposure_conversions/);
  assert.match(sql, /orphan profiles/);
  assert.match(sql, /orphan episodes/);
  assert.match(sql, /duplicate favorite pairs/);
  assert.match(sql, /novel_exposure_rules where id = 1/);
  assert.match(sql, /valid_read_rules where id = 1/);
  assert.match(sql, /novelight_can_favorite_novel/);
  assert.match(sql, /record_valid_read_progress/);
});

test('fresh migration replay ends with restored-database validation', () => {
  const replay = read('scripts/run-migration-replay.sh');
  const fairness = replay.lastIndexOf(
    'tests/rls/beta-final-fairness-hardening.sql'
  );
  const restore = replay.lastIndexOf('supabase/checks/restore_validation.sql');
  assert.notEqual(fairness, -1);
  assert.notEqual(restore, -1);
  assert.ok(
    restore > fairness,
    'restored-database validation must run after final migration behavior checks'
  );
  assert.match(
    replay.slice(restore),
    /Fresh NOVELIGHT migration replay passed\./
  );
});
