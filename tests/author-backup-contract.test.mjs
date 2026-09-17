import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const pageUrl = new URL('../my-novels.html', import.meta.url);
const apiUrl = new URL('../api/export-author-backup.js', import.meta.url);
const migrationUrl = new URL(
  '../supabase/migrations/20260917112000_author_backup_exports.sql',
  import.meta.url
);
const precheckUrl = new URL(
  '../supabase/checks/20260917112000_author_backup_exports_precheck.sql',
  import.meta.url
);
const postcheckUrl = new URL(
  '../supabase/checks/20260917112000_author_backup_exports_postcheck.sql',
  import.meta.url
);
const rollbackUrl = new URL(
  '../supabase/rollback/20260917112000_author_backup_exports_rollback.sql',
  import.meta.url
);

test('my novels page exposes authenticated author backup download', async () => {
  const html = await readFile(pageUrl, 'utf8');

  assert.match(html, /id="backup-button"/);
  assert.match(html, /バックアップをダウンロード/);
  assert.match(html, /fetch\('\/api\/export-author-backup'/);
  assert.match(html, /Authorization:`Bearer \$\{session\.access_token\}`/);
  assert.match(html, /response\.blob\(\)/);
});

test('author backup API keeps manuscript queries bound to authenticated user id', async () => {
  const source = await readFile(apiUrl, 'utf8');
  const ownerFilters = source.match(/\.eq\('user_id', userId\)/g) || [];

  assert.equal(ownerFilters.length, 4);
  assert.match(source, /supabase\.auth\.getUser\(token\)/);
  assert.doesNotMatch(source, /req\.body\?\.userId|req\.body\.userId/);
  assert.doesNotMatch(source, /req\.query\?\.userId|req\.query\.userId/);
});

test('author backup migration keeps audit server-only and rate-limited', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(
    sql,
    /create table if not exists public\.author_backup_exports/i
  );
  assert.match(sql, /references auth\.users\(id\) on delete cascade/i);
  assert.match(
    sql,
    /alter table public\.author_backup_exports enable row level security/i
  );
  assert.match(
    sql,
    /revoke all on table public\.author_backup_exports from anon, authenticated/i
  );
  assert.match(sql, /v_recent_count >= 3/i);
  assert.match(sql, /interval '1 hour'/i);
  assert.match(
    sql,
    /grant execute on function public\.novelight_begin_author_backup_export\(uuid\) to service_role/i
  );
});

test('author backup database change ships precheck, postcheck and rollback contracts', async () => {
  const [precheck, postcheck, rollback] = await Promise.all([
    readFile(precheckUrl, 'utf8'),
    readFile(postcheckUrl, 'utf8'),
    readFile(rollbackUrl, 'utf8')
  ]);

  assert.match(precheck, /author_backup_exports already exists/i);
  assert.match(postcheck, /relrowsecurity/i);
  assert.match(postcheck, /client roles must not read/i);
  assert.match(postcheck, /service_role cannot execute/i);
  assert.match(
    rollback,
    /drop function if exists public\.novelight_begin_author_backup_export\(uuid\)/i
  );
  assert.match(rollback, /drop table if exists public\.author_backup_exports/i);
});
