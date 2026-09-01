import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyStagingMigrationTarget } from '../scripts/verify-staging-migration-target.mjs';

const workflow = await readFile(
  '.github/workflows/supabase-staging-sync.yml',
  'utf8'
);
const verifier = await readFile(
  'scripts/verify-staging-migrations.sh',
  'utf8'
);
const remoteParser = await readFile(
  'scripts/extract-supabase-remote.sh',
  'utf8'
);

const PROD_REF = 'fiepaguycecrredwrcwx';

function stagingEnv(overrides = {}) {
  return {
    STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    STAGING_DATABASE_URL:
      'postgresql://postgres:example-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
    ...overrides
  };
}

test('Staging migration target accepts only the matching direct Staging database', () => {
  assert.deepEqual(verifyStagingMigrationTarget(stagingEnv()), {
    projectRef: 'abcdefghijklmnopqrst'
  });

  assert.throws(
    () =>
      verifyStagingMigrationTarget(
        stagingEnv({
          STAGING_DATABASE_URL:
            'postgresql://postgres:example-password@db.otherprojectref.supabase.co:5432/postgres'
        })
      ),
    /database host does not match STAGING_SUPABASE_URL/
  );

  assert.throws(
    () =>
      verifyStagingMigrationTarget(
        stagingEnv({
          STAGING_DATABASE_URL:
            'postgresql://postgres:example-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
        })
      ),
    /database host does not match STAGING_SUPABASE_URL/
  );
});

test('Staging migration target rejects the Production Supabase project', () => {
  assert.throws(
    () =>
      verifyStagingMigrationTarget({
        STAGING_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        STAGING_DATABASE_URL: `postgresql://postgres:example-password@db.${PROD_REF}.supabase.co:5432/postgres`
      }),
    /refusing the Production Supabase project/
  );
});

test('Staging sync workflow is environment-scoped and contains no Production credentials', () => {
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /STAGING_SUPABASE_URL: \$\{\{ vars\.STAGING_SUPABASE_URL \}\}/);
  assert.match(workflow, /STAGING_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /PRODUCTION_DB_PASSWORD/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /production-approval/);
  assert.doesNotMatch(workflow, /environment: production/);
});

test('Staging sync requires explicit confirmation and exact current-main binding', () => {
  assert.match(workflow, /confirmation must be exactly SYNC STAGING/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);

  const mainFetches = workflow.match(/git fetch --no-tags --depth=1 origin main/g) ?? [];
  assert.ok(mainFetches.length >= 2);
  assert.match(workflow, /main changed after the request was created/);
  assert.match(workflow, /main changed before mutation/);
});

test('Staging sync rechecks exact pending set and dry-run before mutation', () => {
  const pendingChecks =
    workflow.match(/verify-staging-migrations\.sh pending/g) ?? [];
  const dryRuns = workflow.match(/supabase db push --db-url .* --dry-run/g) ?? [];

  assert.ok(pendingChecks.length >= 2);
  assert.ok(dryRuns.length >= 2);
  assert.match(
    workflow,
    /supabase db push --db-url "\$STAGING_DATABASE_URL" --yes/
  );
  assert.doesNotMatch(workflow, /migration repair/);
});

test('Staging sync requires safety artifacts and never auto-runs rollback', () => {
  assert.match(workflow, /verify-staging-migrations\.sh artifacts/);
  assert.match(workflow, /Running precheck for migration/);
  assert.match(workflow, /Running postcheck for migration/);
  assert.match(workflow, /Rollback artifacts were verified before mutation but are never executed automatically/);
  assert.doesNotMatch(workflow, /psql .*rollback/);

  assert.match(verifier, /supabase\/checks\/.*_precheck\.sql/);
  assert.match(verifier, /supabase\/checks\/.*_postcheck\.sql/);
  assert.match(verifier, /supabase\/rollback\/.*_rollback\.sql/);
});

test('Staging sync verifies exact repository parity after apply', () => {
  assert.match(workflow, /verify-staging-migrations\.sh parity/);
  assert.match(verifier, /extract-supabase-pending\.sh/);
  assert.match(verifier, /extract-supabase-remote\.sh/);
  assert.match(verifier, /remote history does not exactly match the repository/);
  assert.match(remoteParser, /remote_col=\$2/);
});
