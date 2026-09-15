import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read(
  'supabase/migrations/20260915173000_enforce_profile_auth_user_integrity.sql'
);
const precheck = read(
  'supabase/checks/20260915173000_enforce_profile_auth_user_integrity_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260915173000_enforce_profile_auth_user_integrity_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260915173000_enforce_profile_auth_user_integrity_rollback.sql'
);

test('migration fails closed for orphan profiles that still own data', () => {
  assert.match(migration, /Found % orphan profile\(s\) with dependent data/);
  assert.match(migration, /public\.novels/);
  assert.match(migration, /public\.episodes/);
  assert.match(migration, /public\.favorites/);
  assert.match(migration, /public\.user_lifecycle/);
  assert.match(migration, /public\.user_acquisition/);
  assert.match(migration, /public\.billing_checkout_attempts/);
  assert.match(migration, /public\.novel_comments/);
});

test('migration removes safe orphans before adding a validated cascade FK', () => {
  assert.match(
    migration,
    /delete from public\.profiles p[\s\S]*not exists \(select 1 from auth\.users u where u\.id = p\.id\)/
  );
  assert.match(
    migration,
    /foreign key \(id\)[\s\S]*references auth\.users\(id\)[\s\S]*on delete cascade[\s\S]*not valid/i
  );
  assert.match(
    migration,
    /validate constraint profiles_id_auth_user_fkey/i
  );
});

test('precheck refuses drift and unsafe cleanup', () => {
  assert.match(precheck, /profiles already has an auth\.users foreign key/);
  assert.match(precheck, /manual review required/);
  assert.match(precheck, /safe_orphan_profiles_to_remove/);
});

test('postcheck requires exact validated cascade FK and zero orphans', () => {
  assert.match(postcheck, /profiles_id_auth_user_fkey is missing/);
  assert.match(postcheck, /must use ON DELETE CASCADE/);
  assert.match(postcheck, /must be validated/);
  assert.match(postcheck, /Found % orphan profile\(s\) after migration/);
});

test('rollback removes only the new constraint and never recreates orphan rows', () => {
  assert.match(
    rollback,
    /drop constraint if exists profiles_id_auth_user_fkey/
  );
  assert.doesNotMatch(rollback, /insert into public\.profiles/i);
});
