import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260917123000_author_work_export.sql',
  import.meta.url
);
const rollbackUrl = new URL(
  '../supabase/rollback/20260917123000_author_work_export_rollback.sql',
  import.meta.url
);
const precheckUrl = new URL(
  '../supabase/checks/20260917123000_author_work_export_precheck.sql',
  import.meta.url
);
const postcheckUrl = new URL(
  '../supabase/checks/20260917123000_author_work_export_postcheck.sql',
  import.meta.url
);
const uiUrl = new URL('../my-novels.html', import.meta.url);
const exportClientUrl = new URL(
  '../novelight-author-work-export.js',
  import.meta.url
);
const removedApiUrl = new URL('../api/author-work-export.js', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('work export authorization is bound to auth.uid and owner-only', async () => {
  const migration = await text(migrationUrl);

  assert.match(
    migration,
    /novelight_authorize_work_export\(\s*p_novel_id bigint,\s*p_format text/i
  );
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/i);
  assert.match(
    migration,
    /n\.id = p_novel_id[\s\S]*n\.user_id = v_uid/i
  );
  assert.doesNotMatch(migration, /p_user_id/i);
  assert.match(
    migration,
    /grant execute on function public\.novelight_authorize_work_export\(bigint, text\) to authenticated/i
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_authorize_work_export\(bigint, text\) from anon/i
  );
});

test('work export audit is private and rate limits are concurrency-safe', async () => {
  const migration = await text(migrationUrl);
  const postcheck = await text(postcheckUrl);

  assert.match(migration, /public\.author_work_export_audit/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on table public\.author_work_export_audit from authenticated/i
  );
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /interval '10 minutes'/i);
  assert.match(migration, />= 10/i);
  assert.match(migration, /interval '24 hours'/i);
  assert.match(migration, />= 50/i);
  assert.match(migration, /author_export_rate_limited/i);
  assert.match(postcheck, /client role has direct author export audit access/i);
  assert.match(
    postcheck,
    /anonymous role can execute author export authorization/i
  );
});

test('author backup UI exports owned manuscript data as TXT without evaluation metrics', async () => {
  const ui = await text(uiUrl);
  const client = await text(exportClientUrl);

  assert.match(ui, /novelight-author-work-export\.js/);
  assert.match(ui, /data-author-work-export/);
  assert.match(ui, /TXTバックアップ/);
  assert.match(client, /novelight_authorize_work_export/);
  assert.match(client, /\.eq\('user_id',userId\)/);
  assert.match(client, /\.from\('novels'\)/);
  assert.match(client, /\.from\('episodes'\)/);
  assert.match(client, /NOVELIGHT 作品バックアップ/);
  assert.match(client, /あらすじ:/);
  assert.match(client, /本文:/);
  assert.match(client, /scheduled_publish_at/);
  assert.match(client, /new Blob/);
  assert.match(client, /text\/plain;charset=utf-8/);
  assert.doesNotMatch(
    client,
    /\bpv\b|favorite_count|light_seed|scout_xp|work_rank|final_rank/i
  );
  assert.doesNotMatch(client, /p_user_id/i);
});

test('service-role export API was removed from the branch design', async () => {
  await assert.rejects(access(removedApiUrl));
});

test('migration safety artifacts match the authenticated RPC signature', async () => {
  const migration = await text(migrationUrl);
  const rollback = await text(rollbackUrl);
  const precheck = await text(precheckUrl);
  const postcheck = await text(postcheckUrl);

  for (const artifact of [migration, rollback, precheck, postcheck]) {
    assert.match(
      artifact,
      /novelight_authorize_work_export\(bigint(?:, |,)text\)/i
    );
    assert.doesNotMatch(
      artifact,
      /novelight_authorize_work_export\(uuid,bigint,text\)/i
    );
  }

  assert.match(
    rollback,
    /drop table if exists public\.author_work_export_audit/i
  );
  assert.doesNotMatch(rollback, /drop table if exists public\.novels\b/i);
  assert.doesNotMatch(rollback, /drop table if exists public\.episodes\b/i);
});
