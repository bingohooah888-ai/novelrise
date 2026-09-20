import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration = read(
  'supabase/migrations/20260920122000_founding_beta_qualifications.sql'
);
const precheck = read(
  'supabase/checks/20260920122000_founding_beta_qualifications_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260920122000_founding_beta_qualifications_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260920122000_founding_beta_qualifications_rollback.sql'
);
const adminApi = read('api/admin-beta-authors.js');
const adminHtml = read('admin-beta-authors.html');

test('Founding qualification follows preregistration order without a 100-person cap', () => {
  assert.match(migration, /beta_author_founding_qualifications/);
  assert.match(
    migration,
    /row_number\(\) over \(order by p\.created_at asc, p\.id asc\)/
  );
  assert.match(migration, /beta_author_founding_number_allocator/);
  assert.match(migration, /last_number = a\.last_number \+ 1/);
  assert.match(
    migration,
    /drop constraint if exists founding_authors_founding_number_check/
  );
  assert.match(
    migration,
    /drop trigger if exists novels_assign_founding_author/
  );
  assert.match(
    migration,
    /drop function if exists public\.assign_founding_author\(\)/
  );
  assert.doesNotMatch(
    migration,
    /if v_next <= 100 then[\s\S]*insert into public\.founding_authors/
  );
  assert.match(postcheck, /Founding Authors still has a 100-person constraint/);
});

test('beta participation is a separate permanent qualification with no ordinal', () => {
  assert.match(migration, /create table public\.beta_participants/);
  assert.match(migration, /timestamptz '2026-09-28 00:00:00\+09'/);
  assert.doesNotMatch(
    migration.match(
      /create table public\.beta_participants \([\s\S]*?\n\);/
    )?.[0] ?? '',
    /founding_number/
  );
  assert.match(
    postcheck,
    /Beta qualification window does not start at the formal preopen/
  );
});

test('internal automation uses admin-controlled app metadata and remains excluded', () => {
  assert.match(migration, /raw_app_meta_data ->> 'internal_e2e'/);
  assert.doesNotMatch(migration, /raw_user_meta_data ->> 'internal_e2e'/);
  assert.match(precheck, /auth\.users\.raw_app_meta_data is required/);
  for (const source of [
    read('scripts/production-auth-smoke-fixture.mjs'),
    read('scripts/production-beta-billing-control.mjs'),
    read('scripts/production-webhook-control.mjs'),
    read('api/production-billing-remediate.js')
  ]) {
    assert.match(source, /app_metadata:\s*\{\s*internal_e2e:\s*true\s*\}/);
  }
});
test('participation ledgers are private and ADMIN exposes the required aggregates', () => {
  assert.match(
    migration,
    /revoke all on table public\.beta_author_founding_qualifications[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    migration,
    /revoke all on table public\.beta_participants[\s\S]*from public, anon, authenticated/
  );
  assert.match(migration, /novelight_admin_beta_participation_metrics/);
  for (const key of [
    'validPreregistrations',
    'latestFoundingNumber',
    'linkedPreregistrations',
    'betaParticipants',
    'foundingBadgeEligible',
    'betaBadgeEligible'
  ]) {
    assert.match(adminApi, new RegExp(key));
  }
  assert.match(adminApi, /beta_author_founding_qualifications/);
  assert.match(adminHtml, /有効な先行登録者/);
  assert.match(adminHtml, /先行登録 最新番号/);
  assert.match(adminHtml, /Foundingバッジ対象/);
  assert.match(adminHtml, /β記念バッジ対象/);
  assert.match(adminHtml, /Founding #/);
});

test('rollback is guarded against post-migration participation drift', () => {
  assert.match(rollback, /beta qualification window changed after migration/);
  assert.match(rollback, /beta participant history changed after migration/);
  assert.match(rollback, /preregistration population changed after migration/);
  assert.match(rollback, /Auth user population changed after migration/);
  assert.match(rollback, /founding_beta_20260920122000_founding_authors/);
});
