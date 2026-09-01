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

function requirePatterns(source, patterns) {
  for (const pattern of patterns) {
    assert.match(source, pattern);
  }
}

test('Staging request bridge is owner-only', () => {
  requirePatterns(requestWorkflow, [
    /issue_comment:/,
    /github\.event\.issue\.number == 294/,
    /github\.event\.issue\.title == '\[Staging Control\] Supabase migration sync'/,
    /github\.event\.issue\.user\.login == 'bingohooah888-ai'/,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/,
    /github\.event\.comment\.author_association == 'OWNER'/,
    /NOVELIGHT_STAGING_MIGRATION_SYNC /
  ]);
});

test('Staging request validates exact mutation inputs', () => {
  requirePatterns(requestWorkflow, [
    /test\("\^\[0-9a-f\]\{40\}\$"\)/,
    /test\("\^\[0-9\]\{14\}\$"\)/,
    /\.confirmation == "SYNC STAGING"/,
    /\["confirmation", "mainSha", "migration"\]/,
    /main changed before the request was claimed/
  ]);
});

test('Staging request has a one-time durable ledger', () => {
  requirePatterns(requestWorkflow, [
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CLAIMED /,
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CONSUMED /,
    /requestCommentId/,
    /already claimed or consumed/,
    /if: always\(\)/
  ]);
});

test('Staging request delegates to fail-closed sync', () => {
  requirePatterns(requestWorkflow, [
    /uses: \.\/\.github\/workflows\/supabase-staging-sync\.yml/,
    /revision: \$\{\{ needs\.request\.outputs\.main_sha \}\}/,
    /migrations: \$\{\{ needs\.request\.outputs\.migration \}\}/,
    /confirmation: \$\{\{ needs\.request\.outputs\.confirmation \}\}/
  ]);
  requirePatterns(syncWorkflow, [
    /workflow_call:/,
    /workflow_dispatch:/,
    /environment: staging/,
    /verify-staging-migrations\.sh pending/,
    /db push --db-url "\$STAGING_DATABASE_URL" --yes/,
    /verify-staging-migrations\.sh parity/
  ]);
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
    assert.doesNotMatch(requestWorkflow, pattern);
  }
});
