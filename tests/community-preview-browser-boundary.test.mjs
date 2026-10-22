import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPreviewBrowserBoundary,
  checkPreviewBrowserBoundary
} from '../scripts/community-preview-browser-boundary.mjs';

const origin = 'https://community-pr-test.vercel.app';
const staging = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const key = 'sb_publishable_dummy_for_staging_testing';
const credentials = {
  CANONICAL_STAGING_URL: origin,
  STAGING_EXPECTED_SUPABASE_URL: staging,
  STAGING_EXPECTED_PUBLISHABLE_KEY: key,
  VERCEL_AUTOMATION_BYPASS_SECRET: 'opaque-bypass-test-value'
};

function config(values = {}) {
  return {
    supabaseUrl: staging,
    supabasePublishableKey: key,
    ...values
  };
}

function response(payload = config()) {
  return {
    status: 200,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => payload
  };
}

test('reject Production or wrong Staging browser config', () => {
  assert.throws(
    () =>
      assertPreviewBrowserBoundary({
        origin,
        expectedUrl: staging,
        expectedKey: key,
        config: config({
          supabaseUrl: 'https://fiepaguycecrredwrcwx.supabase.co'
        })
      }),
    /browser-side connection/u
  );
  assert.throws(
    () =>
      assertPreviewBrowserBoundary({
        origin,
        expectedUrl: 'https://other.supabase.co',
        expectedKey: key,
        config: config()
      }),
    /dedicated Staging identity/u
  );
});

test('reject unsafe Preview hosts, secret keys and extra fields', () => {
  for (const url of [
    'https://novelrise.vercel.app',
    'http://preview.vercel.app'
  ]) {
    assert.throws(
      () =>
        assertPreviewBrowserBoundary({
          origin: url,
          expectedUrl: staging,
          expectedKey: key,
          config: config()
        }),
      /non-Production origin/u
    );
  }
  assert.throws(
    () =>
      assertPreviewBrowserBoundary({
        origin,
        expectedUrl: staging,
        expectedKey: 'sb_secret_test_not_for_browser',
        config: config({
          supabasePublishableKey: 'sb_secret_test_not_for_browser'
        })
      }),
    /secret-class key/u
  );
  assert.throws(
    () =>
      assertPreviewBrowserBoundary({
        origin,
        expectedUrl: staging,
        expectedKey: key,
        config: config({ serviceKey: 'never expose' })
      }),
    /fields changed/u
  );
});

test('verify browser config via a read-only protected GET', async () => {
  let requests = 0;
  async function mockRequest(url, options) {
    requests += 1;
    assert.equal(url, origin + '/api/staging-browser-config');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(
      options.headers['x-vercel-protection-bypass'],
      credentials.VERCEL_AUTOMATION_BYPASS_SECRET
    );
    return response();
  }
  const result = await checkPreviewBrowserBoundary(credentials, mockRequest);
  assert.equal(requests, 1);
  assert.deepEqual(result, { origin, stagingUrl: staging });
  assert.doesNotMatch(JSON.stringify(result), /sb_publishable/u);
});

test('reject blocked and non-JSON config endpoints', async () => {
  await assert.rejects(
    () =>
      checkPreviewBrowserBoundary(credentials, async () => ({
        ...response(),
        status: 403
      })),
    /unavailable or protected/u
  );
  await assert.rejects(
    () =>
      checkPreviewBrowserBoundary(credentials, async () => ({
        ...response(),
        headers: { get: () => 'text/html' }
      })),
    /unavailable or protected/u
  );
});

test('missing bypass secret denies network access', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      checkPreviewBrowserBoundary(
        { ...credentials, VERCEL_AUTOMATION_BYPASS_SECRET: '' },
        async () => {
          calls += 1;
          return response();
        }
      ),
    /protection bypass missing/u
  );
  assert.equal(calls, 0);
});
