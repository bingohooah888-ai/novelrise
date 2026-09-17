import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260917173000_episode_revision_fk_indexes.sql',
  import.meta.url
);
const precheckUrl = new URL(
  '../supabase/checks/20260917173000_episode_revision_fk_indexes_precheck.sql',
  import.meta.url
);
const postcheckUrl = new URL(
  '../supabase/checks/20260917173000_episode_revision_fk_indexes_postcheck.sql',
  import.meta.url
);
const rollbackUrl = new URL(
  '../supabase/rollback/20260917173000_episode_revision_fk_indexes_rollback.sql',
  import.meta.url
);

async function text(url) {
  return readFile(url, 'utf8');
}

test('episode revision foreign keys receive covering indexes', async () => {
  const migration = await text(migrationUrl);

  assert.match(migration, /episode_revisions_novel_id_idx/i);
  assert.match(migration, /on public\.episode_revisions \(novel_id\)/i);
  assert.match(migration, /episode_revisions_user_id_idx/i);
  assert.match(migration, /on public\.episode_revisions \(user_id\)/i);
});

test('index safety artifacts stay bounded to episode revisions', async () => {
  const precheck = await text(precheckUrl);
  const postcheck = await text(postcheckUrl);
  const rollback = await text(rollbackUrl);

  assert.match(precheck, /public\.episode_revisions/);
  assert.match(postcheck, /episode_revisions_novel_id_idx/);
  assert.match(postcheck, /episode_revisions_user_id_idx/);
  assert.match(rollback, /drop index if exists public\.episode_revisions_user_id_idx/i);
  assert.match(rollback, /drop index if exists public\.episode_revisions_novel_id_idx/i);
  assert.doesNotMatch(rollback, /drop table|drop function|drop trigger/i);
});
