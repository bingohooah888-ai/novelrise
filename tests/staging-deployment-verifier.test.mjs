import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyStagingDeployment } from '../scripts/verify-staging-deployment.mjs';

const EXPECTED_SHA = '1234567890abcdef1234567890abcdef12345678';
const BASE_URL = 'https://novelrise-preview-123.vercel.app';
const SUPABASE_URL = 'https://staging-project.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_staging_example';

function facts(overrides = {}) {
  return {
    commitSha: EXPECTED_SHA,
    vercelEnv: 'preview',
    appBaseUrl: BASE_URL,
    supabase: {
      url: SUPABASE_URL,
      publishableKeyClass: 'publishable',
      publishableKeyFingerprint: createHash('sha256')
        .update(PUBLISHABLE_KEY)
        .digest('hex'),
      serverSecretPresent: true
    },
    stripe: {
      secretKeyMode: 'test',
      standardPricePresent: true,
      premiumPricePresent: true
    },
    ...overrides
  };
}

function strictEnvironment(overrides = {}) {
  return {
    STAGING_TRIGGER: 'deployment_status',
    DEPLOYMENT_ENVIRONMENT_URL: BASE_URL,
    EXPECTED_REVISION: EXPECTED_SHA,
    STAGING_REQUIRE_WRITE_CONFIG: 'true',
    STAGING_EXPECTED_SUPABASE_URL: SUPABASE_URL,
    STAGING_EXPECTED_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-secret-for-test',
    ...overrides
  };
}

test('verifier proves exact Preview revision and deployed Staging configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'novelight-staging-'));
  const githubEnv = join(directory, 'github-env');
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new globalThis.Response(JSON.stringify(facts()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });

  const result = await verifyStagingDeployment(
    strictEnvironment({ GITHUB_ENV: githubEnv })
  );

  assert.deepEqual(result, { baseUrl: BASE_URL, revision: EXPECTED_SHA });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE_URL}/api/staging-environment-facts`);
  assert.equal(
    calls[0].options.headers['x-vercel-protection-bypass'],
    'bypass-secret-for-test'
  );

  const exported = await readFile(githubEnv, 'utf8');
  assert.match(exported, new RegExp(`STAGING_BASE_URL=${BASE_URL}`));
  assert.match(exported, new RegExp(`E2E_BASE_URL=${BASE_URL}`));
});

test('verifier fails closed before network access for Production Vercel target', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not run');
  });

  await assert.rejects(
    verifyStagingDeployment(
      strictEnvironment({
        DEPLOYMENT_ENVIRONMENT_URL: 'https://novelrise.vercel.app'
      })
    ),
    /CONFIG_DRIFT: refusing the Production Vercel host/
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('verifier rejects deployed live Stripe configuration before writes', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new globalThis.Response(
        JSON.stringify(
          facts({
            stripe: {
              secretKeyMode: 'live',
              standardPricePresent: true,
              premiumPricePresent: true
            }
          })
        ),
        { status: 200 }
      )
  );

  await assert.rejects(
    verifyStagingDeployment(strictEnvironment()),
    /CONFIG_DRIFT: deployed Stripe secret key mode must be test/
  );
});

test('manual verification uses only explicit or canonical URL plus explicit revision', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new globalThis.Response(JSON.stringify(facts()), { status: 200 })
  );

  await verifyStagingDeployment(
    strictEnvironment({
      STAGING_TRIGGER: 'workflow_dispatch',
      DEPLOYMENT_ENVIRONMENT_URL: '',
      MANUAL_STAGING_URL: '',
      CANONICAL_STAGING_URL: BASE_URL
    })
  );

  await assert.rejects(
    verifyStagingDeployment(
      strictEnvironment({
        STAGING_TRIGGER: 'workflow_dispatch',
        DEPLOYMENT_ENVIRONMENT_URL: '',
        MANUAL_STAGING_URL: '',
        CANONICAL_STAGING_URL: BASE_URL,
        EXPECTED_REVISION: ''
      })
    ),
    /CONFIG_DRIFT: EXPECTED_REVISION must be an exact 40-character commit SHA/
  );
});
