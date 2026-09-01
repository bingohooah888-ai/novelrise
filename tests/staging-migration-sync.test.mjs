import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const SECRET_ENV =
  'STAGING_DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}';
const bashAvailable =
  spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

function stagingEnv(overrides = {}) {
  return {
    STAGING_SUPABASE_URL: STAGING_URL,
    STAGING_DATABASE_URL: STAGING_DB,
    PGSSLMODE: 'require',
    ...overrides
  };
}

function stepBlock(name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow step not found: ${name}`);
  const next = workflow.indexOf('\n      - name: ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

function runRemoteParser(input) {
  return spawnSync('bash', ['scripts/extract-supabase-remote.sh'], {
    input,
    encoding: 'utf8'
  });
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

test('Staging target rejects Production project and weak TLS', () => {
  const production = {
    STAGING_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    STAGING_DATABASE_URL:
      `postgresql://postgres:example-password@db.${PROD_REF}.supabase.co` +
      ':5432/postgres',
    PGSSLMODE: 'require'
  };
  assert.throws(
    () => verifyStagingMigrationTarget(production),
    /refusing the Production Supabase project/
  );
  assert.throws(
    () => verifyStagingMigrationTarget(stagingEnv({ PGSSLMODE: 'prefer' })),
    /PGSSLMODE must be exactly require/
  );
});

test('Staging sync isolates the database secret from third-party actions', () => {
  const jobEnvStart = workflow.indexOf('    env:');
  const stepsStart = workflow.indexOf('\n    steps:');
  assert.notEqual(jobEnvStart, -1);
  assert.notEqual(stepsStart, -1);
  assert.doesNotMatch(
    workflow.slice(jobEnvStart, stepsStart),
    /STAGING_DATABASE_URL/
  );

  assert.doesNotMatch(
    stepBlock('Checkout exact requested revision'),
    /STAGING_DATABASE_URL/
  );
  assert.doesNotMatch(stepBlock('Setup Supabase CLI'), /STAGING_DATABASE_URL/);
  assert.doesNotMatch(
    stepBlock('Require migration safety artifacts'),
    /STAGING_DATABASE_URL/
  );

  assert.match(workflow, /\$GITHUB_ACTOR.*bingohooah888-ai/);
  assert.match(
    workflow,
    /only the repository owner may dispatch this mutation/
  );
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /vars\.STAGING_SUPABASE_URL/);
  assert.equal(workflow.includes(SECRET_ENV), true);
  assert.doesNotMatch(workflow, /PRODUCTION_DB_PASSWORD/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /production-approval/);
  assert.doesNotMatch(workflow, /environment: production/);
});

test('Staging database operations require encrypted transport', () => {
  const databaseSteps = [
    'Verify dedicated Staging database target',
    'Run Staging migration prechecks',
    'Require exact Staging pending migrations',
    'Dry-run exact Staging migration set',
    'Re-bind target and pending set immediately before mutation',
    'Apply exact pending migrations to dedicated Staging',
    'Run Staging migration postchecks',
    'Verify exact repository and Staging migration parity'
  ];

  for (const name of databaseSteps) {
    const block = stepBlock(name);
    assert.equal(block.includes(SECRET_ENV), true, name);
    assert.match(block, /PGSSLMODE: require/, name);
  }

  assert.match(verifier, /PGSSLMODE must be exactly require/);
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
  const pending =
    workflow.match(/verify-staging-migrations\.sh pending/g) ?? [];
  const dryRuns =
    workflow.match(/supabase db push --db-url .* --dry-run/g) ?? [];
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

test(
  'Staging remote-history parser accepts canonical rows',
  { skip: !bashAvailable },
  () => {
    const result = runRemoteParser(`
   Local            | Remote           | Time (UTC)
  ------------------|------------------|-----------------------
   \`20260815000000\` | \` \`              | \`2026-08-15 00:00:00\`
   \`20260819190000\` | \`20260819190000\` | \`2026-08-19 19:00:00\`
   20260822194000   | 20260822194000   | 2026-08-22 19:40:00
`);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      '20260819190000',
      '20260822194000'
    ]);
  }
);

test(
  'Staging remote-history parser fails closed on malformed rows',
  { skip: !bashAvailable },
  () => {
    const result = runRemoteParser(`
   Local            | Remote           | Time (UTC)
  ------------------|------------------|-----------------------
   20260819190000   | 20260819oops     | 2026-08-19 19:00:00
`);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /malformed remote migration-history row/);
  }
);

test('Staging sync verifies exact parity', () => {
  assert.match(workflow, /verify-staging-migrations\.sh parity/);
  assert.match(verifier, /extract-supabase-pending\.sh/);
  assert.match(verifier, /extract-supabase-remote\.sh/);
  assert.match(
    verifier,
    /remote history does not exactly match the repository/
  );
  assert.match(parser, /fail_row/);
});
