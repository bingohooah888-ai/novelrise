import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = '20261031173000_followed_authors_list';
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/' + prefix + '.sql');
const precheck = read('supabase/checks/' + prefix + '_precheck.sql');
const postcheck = read('supabase/checks/' + prefix + '_postcheck.sql');
const rollback = read('supabase/rollback/' + prefix + '_rollback.sql');

const signatures = [
  'novelight_followed_authors(integer,integer)',
  'novelight_followers(integer,integer)',
  'novelight_follow_counts()'
];

test('candidate SQL artifacts are present and precheck is read only', () => {
  assert.match(precheck, /to_regclass/);
  assert.match(precheck, /relrowsecurity/);
  assert.match(precheck, /Existing follow RPC prerequisites unavailable/);
  for (const fn of signatures) {
    assert.ok(precheck.includes('public.' + fn));
    assert.ok(postcheck.includes('public.' + fn));
    assert.ok(rollback.includes('public.' + fn));
  }
  assert.doesNotMatch(precheck, /\\b(?:insert|update|delete|alter|drop)\\s+/i);
});

test('RPC migration is owner bound and restricts privileges', () => {
  assert.equal((migration.match(/security definer/g) || []).length, 3);
  assert.equal((migration.match(/set search_path = ''/g) || []).length, 3);
  assert.equal((migration.match(/auth\\.uid\\(\\)/g) || []).length, 3);
  assert.match(migration, /from public\\.user_blocks/);
  assert.match(migration, /revoke all on function/);
  assert.match(migration, /to authenticated/);
  assert.doesNotMatch(migration, /grant select on public\\.author_follows/i);
});

test('postcheck verifies private EXECUTE ACLs and no raw anon SELECT', () => {
  assert.match(postcheck, /pg_catalog\\.aclexplode/);
  assert.match(postcheck, /acl\\.grantee = 0/);
  assert.match(postcheck, /has_function_privilege\\('anon'/);
  assert.match(postcheck, /has_function_privilege\\('authenticated'/);
  assert.match(postcheck, /has_table_privilege\\('anon'/);
  assert.match(postcheck, /prosecdef/);
  assert.doesNotMatch(postcheck, /\\b(?:insert|update|delete|alter|drop)\\s+/i);
});

test('rollback is manual, exact-scoped and noncascading', () => {
  assert.match(rollback, /MANUAL RECOVERY ONLY/);
  assert.equal((rollback.match(/^drop function /gm) || []).length, 3);
  for (const fn of signatures) {
    assert.ok(rollback.includes('drop function public.' + fn));
  }
  assert.doesNotMatch(rollback, /\\bcascade\\b/i);
  assert.doesNotMatch(rollback, /\\b(?:delete|truncate|drop table)\\b/i);
});
