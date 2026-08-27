import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/staging-smoke.yml', 'utf8');
const verifier = await readFile(
  'scripts/verify-staging-deployment.mjs',
  'utf8'
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
    'node scripts/verify-staging-deployment.mjs'
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
  assert.match(workflow, /environment: staging/);

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
