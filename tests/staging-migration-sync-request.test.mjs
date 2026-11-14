import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const requestWorkflow = await readFile(
  '.github/workflows/supabase-staging-sync-request.yml',
  'utf8'
);
const syncWorkflow = await readFile(
  '.github/workflows/supabase-staging-sync.yml',
  'utf8'
);

const readerStart = requestWorkflow.indexOf(
  '\n  # Separate OWNER-only proof for one new synthetic Staging reader.'
);
assert.notEqual(readerStart, -1, 'missing isolated new-reader jobs');
const migrationRequestWorkflow = requestWorkflow.slice(0, readerStart);
const newReaderWorkflow = requestWorkflow.slice(readerStart);

function requirePatterns(source, patterns) {
  for (const pattern of patterns) {
    assert.match(source, pattern);
  }
}

test('Staging request bridge is owner-only', () => {
  requirePatterns(migrationRequestWorkflow, [
    /issue_comment:/,
    /github\.event\.issue\.number == 294/,
    /github\.event\.issue\.title == '\[Staging Control\] Supabase migration sync'/,
    /github\.event\.issue\.user\.login == 'bingohooah888-ai'/,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/,
    /github\.event\.comment\.author_association == 'OWNER'/,
    /NOVELIGHT_STAGING_APPROVE /
  ]);
});

test('Staging request validates exact mutation inputs', () => {
  requirePatterns(migrationRequestWorkflow, [
    /test\("\^\[0-9a-f\]\{40\}\$"\)/,
    /test\("\^\[0-9\]\{14\}\$"\)/,
    /\.scope == "migration-sync"/,
    /\.confirmation == "STAGING APPROVED"/,
    /\["confirmation", "mainSha", "migration", "scope"\]/,
    /main changed before the request was claimed/
  ]);
});

test('Staging request has a one-time durable ledger', () => {
  requirePatterns(migrationRequestWorkflow, [
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CLAIMED /,
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CONSUMED /,
    /requestCommentId/,
    /already claimed or consumed/,
    /if: always\(\)/
  ]);
});

test('Staging request delegates to fail-closed sync', () => {
  requirePatterns(migrationRequestWorkflow, [
    /uses: \.\/\.github\/workflows\/supabase-staging-sync\.yml/,
    /revision: \$\{\{ needs\.request\.outputs\.main_sha \}\}/,
    /migrations: \$\{\{ needs\.request\.outputs\.migration \}\}/,
    /confirmation: \$\{\{ needs\.request\.outputs\.confirmation \}\}/,
    /secrets: inherit/
  ]);
  requirePatterns(syncWorkflow, [
    /workflow_call:/,
    /environment: staging/,
    /verify-staging-migrations\.sh pending/,
    /db push --db-url "\$STAGING_DATABASE_URL" --yes/,
    /verify-staging-migrations\.sh parity/
  ]);
  assert.doesNotMatch(syncWorkflow, /workflow_dispatch:/);
});

test('Staging request bridge excludes DB credentials', () => {
  const forbidden = [
    /STAGING_DATABASE_URL/,
    /PRODUCTION_DB_PASSWORD/,
    /SUPABASE_ACCESS_TOKEN/,
    /production-approval/,
    /environment: production/,
    /rollback/,
    /db push/
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(migrationRequestWorkflow, pattern);
  }
});

test('New-reader Staging proof keeps its own scoped credentials and two atomic inserts', () => {
  requirePatterns(newReaderWorkflow, [
    /^  admit_one_new_reader:/m,
    /^  stage_one_new_reader:/m,
    /^  record_one_new_reader:/m,
    /NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE /,
    /environment: staging/,
    /STAGING_DATABASE_URL_SOURCE: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/,
    /STAGING_SUPABASE_SECRET_KEY: \$\{\{ secrets\.STAGING_SUPABASE_SECRET_KEY \}\}/,
    /STAGING_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.STAGING_SUPABASE_PUBLISHABLE_KEY \}\}/,
    /app_metadata:\{internal_e2e:true\}/,
    /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/
  ]);
  const stage = newReaderWorkflow.slice(
    newReaderWorkflow.indexOf('\n  stage_one_new_reader:'),
    newReaderWorkflow.indexOf('\n  record_one_new_reader:')
  );
  const jobEnv = stage.slice(stage.indexOf('\n    env:'), stage.indexOf('\n    steps:'));
  assert.doesNotMatch(
    jobEnv,
    /STAGING_DATABASE_URL_SOURCE:|STAGING_SUPABASE_SECRET_KEY:|STAGING_SUPABASE_PUBLISHABLE_KEY:/
  );
  assert.equal((newReaderWorkflow.match(/INSERT INTO novelight_formal_private\./g) || []).length, 2);
  for (const forbidden of [
    /PRODUCTION_DB_PASSWORD/,
    /SUPABASE_ACCESS_TOKEN/,
    /environment: production/,
    /workflow_dispatch:/,
    /db push/
  ]) {
    assert.doesNotMatch(newReaderWorkflow, forbidden);
  }
});
