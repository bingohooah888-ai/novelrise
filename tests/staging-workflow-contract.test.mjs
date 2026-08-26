import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPaths = [
  '.github/workflows/staging-readiness-smoke.yml',
  '.github/workflows/staging-authenticated-smoke.yml',
  '.github/workflows/staging-billing-smoke.yml'
];
const workflows = await Promise.all(
  workflowPaths.map((path) => readFile(path, 'utf8'))
);
const verifier = await readFile(
  'scripts/verify-staging-deployment.mjs',
  'utf8'
);
const checkout = await readFile('api/_lib/checkout.js', 'utf8');
const portal = await readFile('api/_lib/billing-portal.js', 'utf8');

const combined = workflows.join('\n');

test('Staging workflows are not coupled to the historical temporary branch', () => {
  assert.doesNotMatch(combined, /ci\/isolate-staging-auth-smoke/);
  assert.doesNotMatch(combined, /novelrise-git-ci-isolate-staging-auth-smoke/);

  for (const workflow of workflows) {
    assert.match(workflow, /deployment_status:/);
    assert.match(workflow, /revision:/);
    assert.match(workflow, /required: true/);
  }
});

test('all Staging workflows run the shared deployment contract before package installation', () => {
  for (const workflow of workflows) {
    const verifierIndex = workflow.indexOf(
      'node scripts/verify-staging-deployment.mjs'
    );
    const installIndex = workflow.indexOf('npm ci');
    assert.notEqual(verifierIndex, -1);
    assert.notEqual(installIndex, -1);
    assert.ok(verifierIndex < installIndex);
  }
});

test('write Staging workflows require deployed Supabase and Stripe isolation evidence', () => {
  for (const workflow of workflows.slice(1)) {
    assert.match(workflow, /STAGING_REQUIRE_WRITE_CONFIG: 'true'/);
    assert.match(workflow, /STAGING_EXPECTED_SUPABASE_URL/);
    assert.match(workflow, /STAGING_EXPECTED_PUBLISHABLE_KEY/);
    assert.match(workflow, /environment: staging/);
  }

  assert.match(verifier, /facts\.stripe\.secretKeyMode !== 'test'/);
  assert.match(verifier, /facts\.supabase\.url !== expectedSupabase/);
  assert.match(verifier, /publishableKeyFingerprint/);
  assert.match(verifier, /facts\.supabase\.serverSecretPresent !== true/);
});

test('Preview billing return URLs use the exact Vercel deployment helper', () => {
  assert.match(checkout, /from '\.\/app-base-url\.js'/);
  assert.match(portal, /from '\.\/app-base-url\.js'/);
  assert.doesNotMatch(checkout, /function getAppBaseUrl/);
  assert.doesNotMatch(portal, /function getAppBaseUrl/);
});
