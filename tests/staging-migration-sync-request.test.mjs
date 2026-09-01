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

test('Staging sync request bridge is owner-only and bound to the control issue', () => {
  assert.match(requestWorkflow, /issue_comment:/);
  assert.match(requestWorkflow, /github\.event\.issue\.number == 294/);
  assert.match(
    requestWorkflow,
    /github\.event\.issue\.title == '\[Staging Control\] Supabase migration sync'/
  );
  assert.match(
    requestWorkflow,
    /github\.event\.issue\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    requestWorkflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    requestWorkflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(
    requestWorkflow,
    /NOVELIGHT_STAGING_MIGRATION_SYNC /
  );
});

test('Staging sync request requires exact SHA, one migration, and typed confirmation', () => {
  assert.match(requestWorkflow, /test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(requestWorkflow, /test\("\^\[0-9\]\{14\}\$"\)/);
  assert.match(requestWorkflow, /\.confirmation == "SYNC STAGING"/);
  assert.match(
    requestWorkflow,
    /\["confirmation", "mainSha", "migration"\]/
  );
  assert.match(
    requestWorkflow,
    /main changed before the request was claimed/
  );
});

test('Staging sync request is one-time and records a durable ledger', () => {
  assert.match(
    requestWorkflow,
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CLAIMED /
  );
  assert.match(
    requestWorkflow,
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CONSUMED /
  );
  assert.match(requestWorkflow, /requestCommentId/);
  assert.match(requestWorkflow, /already claimed or consumed/);
  assert.match(requestWorkflow, /if: always\(\)/);
});

test('Staging request bridge delegates to the existing fail-closed sync workflow', () => {
  assert.match(
    requestWorkflow,
    /uses: \.\/\.github\/workflows\/supabase-staging-sync\.yml/
  );
  assert.match(requestWorkflow, /revision: \$\{\{ needs\.request\.outputs\.main_sha \}\}/);
  assert.match(requestWorkflow, /migrations: \$\{\{ needs\.request\.outputs\.migration \}\}/);
  assert.match(
    requestWorkflow,
    /confirmation: \$\{\{ needs\.request\.outputs\.confirmation \}\}/
  );

  assert.match(syncWorkflow, /workflow_call:/);
  assert.match(syncWorkflow, /workflow_dispatch:/);
  assert.match(syncWorkflow, /environment: staging/);
  assert.match(syncWorkflow, /verify-staging-migrations\.sh pending/);
  assert.match(syncWorkflow, /db push --db-url "\$STAGING_DATABASE_URL" --yes/);
  assert.match(syncWorkflow, /verify-staging-migrations\.sh parity/);
});

test('Staging request bridge never receives database or Production credentials', () => {
  assert.doesNotMatch(requestWorkflow, /STAGING_DATABASE_URL/);
  assert.doesNotMatch(requestWorkflow, /PRODUCTION_DB_PASSWORD/);
  assert.doesNotMatch(requestWorkflow, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(requestWorkflow, /production-approval/);
  assert.doesNotMatch(requestWorkflow, /environment: production/);
  assert.doesNotMatch(requestWorkflow, /rollback/);
  assert.doesNotMatch(requestWorkflow, /db push/);
});
