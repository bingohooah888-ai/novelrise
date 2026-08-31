import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/staging-smoke.yml', 'utf8');
const verifier = await readFile(
  'scripts/verify-staging-deployment.mjs',
  'utf8',
);
const migrationParity = await readFile(
  'scripts/verify-staging-migration-parity.mjs',
  'utf8',
);
const checkout = await readFile('api/_lib/checkout.js', 'utf8');
const portal = await readFile('api/_lib/billing-portal.js', 'utf8');

test('Staging workflow is not coupled to the historical temporary branch', () => {
  assert.doesNotMatch(workflow, /ci\/isolate-staging-auth-smoke/);
  assert.doesNotMatch(workflow, /novelrise-git-ci-isolate-staging-auth-smoke/);
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /revision:/);
  assert.match(workflow, /required: true/);
});

test('consolidated Staging workflow runs the shared deployment contract before package installation', () => {
  const verifierIndex = workflow.indexOf(
    'node scripts/verify-staging-deployment.mjs',
  );
  const installIndex = workflow.indexOf('npm ci');
  assert.notEqual(verifierIndex, -1);
  assert.notEqual(installIndex, -1);
  assert.ok(verifierIndex < installIndex);
});

test('write Staging phases require deployed Supabase and Stripe isolation evidence', () => {
  assert.match(workflow, /STAGING_REQUIRE_WRITE_CONFIG: 'true'/);
  assert.match(workflow, /STAGING_EXPECTED_SUPABASE_URL/);
  assert.match(workflow, /STAGING_EXPECTED_PUBLISHABLE_KEY/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /environment: staging/);

  assert.match(verifier, /facts\.stripe\.secretKeyMode !== 'test'/);
  assert.match(verifier, /facts\.supabase\.url !== expectedSupabase/);
  assert.match(verifier, /publishableKeyFingerprint/);
  assert.match(verifier, /facts\.supabase\.serverSecretPresent !== true/);
});

test('write Staging fails closed on migration history drift before creating users', () => {
  const parityIndex = workflow.indexOf(
    'node scripts/verify-staging-migration-parity.mjs',
  );
  const fixtureIndex = workflow.indexOf(
    'Create ephemeral authenticated Staging desktop users',
  );

  assert.notEqual(parityIndex, -1);
  assert.notEqual(fixtureIndex, -1);
  assert.ok(parityIndex < fixtureIndex);
  assert.match(migrationParity, /supabase_migrations\.schema_migrations/);
  assert.match(migrationParity, /read_only: true/);
  assert.match(migrationParity, /refusing the Production Supabase project/);
  assert.match(migrationParity, /migration history does not exactly match/);
});

test('authenticated Staging desktop and mobile projects use fresh isolated fixtures', () => {
  const desktopSetup = workflow.indexOf(
    'Create ephemeral authenticated Staging desktop users',
  );
  const desktopRun = workflow.indexOf('Run authenticated Staging desktop smoke');
  const desktopCleanup = workflow.indexOf(
    'Clean ephemeral authenticated Staging desktop data',
  );
  const mobileSetup = workflow.indexOf(
    'Create fresh ephemeral authenticated Staging mobile users',
  );
  const mobileRun = workflow.indexOf('Run authenticated Staging mobile smoke');
  const mobileCleanup = workflow.indexOf(
    'Clean ephemeral authenticated Staging mobile data',
  );
  const aggregate = workflow.indexOf(
    'Require authenticated Staging desktop and mobile smoke success',
  );

  for (const index of [
    desktopSetup,
    desktopRun,
    desktopCleanup,
    mobileSetup,
    mobileRun,
    mobileCleanup,
    aggregate,
  ]) {
    assert.notEqual(index, -1);
  }
  assert.ok(desktopSetup < desktopRun);
  assert.ok(desktopRun < desktopCleanup);
  assert.ok(desktopCleanup < mobileSetup);
  assert.ok(mobileSetup < mobileRun);
  assert.ok(mobileRun < mobileCleanup);
  assert.ok(mobileCleanup < aggregate);
  assert.match(workflow, /--project=production-authenticated-chromium/);
  assert.match(
    workflow,
    /--project=production-authenticated-mobile-chromium/,
  );
  assert.match(workflow, /id: auth_desktop[\s\S]*continue-on-error: true/);
  assert.match(workflow, /id: auth_mobile[\s\S]*continue-on-error: true/);
});

test('Preview billing return URLs use the exact Vercel deployment helper', () => {
  assert.match(checkout, /from '\.\/app-base-url\.js'/);
  assert.match(portal, /from '\.\/app-base-url\.js'/);
  assert.doesNotMatch(checkout, /function getAppBaseUrl/);
  assert.doesNotMatch(portal, /function getAppBaseUrl/);
});

test('chat-controlled Staging smoke only accepts the dedicated owner-reopened control issue', () => {
  assert.match(workflow, /issues:\s*\n\s+types: \[reopened\]/);
  assert.doesNotMatch(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 188/);
  assert.match(
    workflow,
    /github\.event\.issue\.user\.login == 'bingohooah888-ai'/,
  );
  assert.match(workflow, /github\.event\.sender\.login == 'bingohooah888-ai'/);
});

test('chat-controlled Staging smoke resolves and rechecks current main before write-capable verification', () => {
  assert.match(workflow, /git\/ref\/heads\/main/);
  assert.match(workflow, /EXPECTED_REVISION=\$target/);
  assert.match(workflow, /Confirm controlled revision is still current main/);
  assert.match(
    workflow,
    /chat-controlled Staging Smoke requires STAGING_E2E_READY=true/,
  );
  assert.match(
    workflow,
    /github\.event_name == 'issues' && 'workflow_dispatch'/,
  );
});

test('Staging execution concurrency is job-scoped so skipped issue events cannot cancel a real smoke', () => {
  const jobsIndex = workflow.indexOf('jobs:');
  const concurrencyIndex = workflow.indexOf('concurrency:');
  assert.notEqual(jobsIndex, -1);
  assert.notEqual(concurrencyIndex, -1);
  assert.ok(concurrencyIndex > jobsIndex);
  assert.match(workflow, /'chat-control'/);
});
