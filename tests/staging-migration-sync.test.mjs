import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const target = await import('../scripts/verify-staging-migration-target.mjs');
const { verifyStagingMigrationTarget } = target;
const workflow = await readFile(
  '.github/workflows/supabase-staging-sync.yml',
  'utf8'
);
const verifier = await readFile('scripts/verify-staging-migrations.sh', 'utf8');
const parser = await readFile('scripts/extract-supabase-remote.sh', 'utf8');

const PROD_REF = 'fiepaguycecrredwrcwx';
const STAGING_REF = 'abcdefghijklmnopqrst';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const STAGING_DB =
  `postgresql://postgres:example-password@db.${STAGING_REF}.supabase.co` +
  ':5432/postgres';

function stagingEnv(overrides = {}) {
  return {
    STAGING_SUPABASE_URL: STAGING_URL,
    STAGING_DATABASE_URL: STAGING_DB,
    ...overrides
  };
}

test('Staging target validates direct project match', () => {
  assert.deepEqual(verifyStagingMigrationTarget(stagingEnv()), {
    projectRef: STAGING_REF
  });

  const otherDb =
    'postgresql://postgres:example-password@db.otherprojectref.supabase.co' +
    ':5432/postgres';
  assert.throws(
    () =>
      verifyStagingMigrationTarget(
        stagingEnv({ STAGING_DATABASE_URL: otherDb })
      ),
    /database host does not match STAGING_SUPABASE_URL/
  );

  const pooler =
    'postgresql://postgres:example-password@aws-0.pooler.supabase.com' +
    ':6543/postgres';
  assert.throws(
    () =>
      verifyStagingMigrationTarget(
        stagingEnv({ STAGING_DATABASE_URL: pooler })
      ),
    /database host does not match STAGING_SUPABASE_URL/
  );
});

test('Staging target rejects Production project', () => {
  const production = {
    STAGING_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    STAGING_DATABASE_URL:
      `postgresql://postgres:example-password@db.${PROD_REF}.supabase.co` +
      ':5432/postgres'
  };
  assert.throws(
    () => verifyStagingMigrationTarget(production),
    /refusing the Production Supabase project/
  );
});

test('Staging sync has isolated credentials', () => {
  assert.match(workflow, /\$GITHUB_ACTOR.*bingohooah888-ai/);
  assert.match(workflow, /only the repository owner may dispatch this mutation/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /vars\.STAGING_SUPABASE_URL/);
  assert.match(workflow, /secrets\.STAGING_DATABASE_URL/);
  assert.doesNotMatch(workflow, /PRODUCTION_DB_PASSWORD/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /production-approval/);
  assert.doesNotMatch(workflow, /environment: production/);
});

test('Staging sync binds owner and current main', () => {
  assert.match(workflow, /confirmation must be exactly SYNC STAGING/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  const mainFetches =
    workflow.match(/git fetch --no-tags --depth=1 origin main/g) ?? [];
  assert.ok(mainFetches.length >= 2);
  assert.match(workflow, /main changed after the request was created/);
  assert.match(workflow, /main changed before mutation/);
});

test('Staging sync rechecks pending set before mutation', () => {
  const pending = workflow.match(/verify-staging-migrations\.sh pending/g) ?? [];
  const dryRuns = workflow.match(/supabase db push --db-url .* --dry-run/g) ?? [];
  assert.ok(pending.length >= 2);
  assert.ok(dryRuns.length >= 2);
  assert.match(workflow, /db push --db-url "\$STAGING_DATABASE_URL" --yes/);
  assert.doesNotMatch(workflow, /migration repair/);
});

test('Staging sync requires safety artifacts', () => {
  assert.match(workflow, /verify-staging-migrations\.sh artifacts/);
  assert.match(workflow, /Running precheck for migration/);
  assert.match(workflow, /Running postcheck for migration/);
  assert.match(workflow, /never executed automatically/);
  assert.doesNotMatch(workflow, /psql .*rollback/);
  assert.match(verifier, /supabase\/checks\/.*_precheck\.sql/);
  assert.match(verifier, /supabase\/checks\/.*_postcheck\.sql/);
  assert.match(verifier, /supabase\/rollback\/.*_rollback\.sql/);
});

test('Staging sync verifies exact parity', () => {
  assert.match(workflow, /verify-staging-migrations\.sh parity/);
  assert.match(verifier, /extract-supabase-pending\.sh/);
  assert.match(verifier, /extract-supabase-remote\.sh/);
  assert.match(verifier, /remote history does not exactly match the repository/);
  assert.match(parser, /remote_col=\$2/);
});
