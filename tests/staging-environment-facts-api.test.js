import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import handler, {
  buildStagingEnvironmentFacts
} from '../api/staging-environment-facts.js';

function response() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function withEnvironment(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('facts expose only non-secret Preview configuration evidence', () => {
  const publishableKey = 'sb_publishable_staging_example';
  const facts = buildStagingEnvironmentFacts({
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'novelrise-preview-123.vercel.app',
    VERCEL_GIT_COMMIT_SHA: '1234567890abcdef1234567890abcdef12345678',
    SUPABASE_URL: 'https://staging-project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: 'sb_secret_must_not_leak',
    STRIPE_SECRET_KEY: 'sk_test_must_not_leak',
    STRIPE_STANDARD_PRICE_ID: 'price_standard',
    STRIPE_PREMIUM_PRICE_ID: 'price_premium'
  });

  assert.equal(facts.vercelEnv, 'preview');
  assert.equal(facts.appBaseUrl, 'https://novelrise-preview-123.vercel.app');
  assert.equal(facts.supabase.url, 'https://staging-project.supabase.co');
  assert.equal(facts.supabase.publishableKeyClass, 'publishable');
  assert.equal(
    facts.supabase.publishableKeyFingerprint,
    createHash('sha256').update(publishableKey).digest('hex')
  );
  assert.equal(facts.supabase.serverSecretPresent, true);
  assert.equal(facts.stripe.secretKeyMode, 'test');
  assert.equal(facts.stripe.standardPricePresent, true);
  assert.equal(facts.stripe.premiumPricePresent, true);

  const serialized = JSON.stringify(facts);
  assert.doesNotMatch(serialized, /sb_secret_must_not_leak/);
  assert.doesNotMatch(serialized, /sk_test_must_not_leak/);
  assert.doesNotMatch(serialized, /sb_publishable_staging_example/);
});

test('facts reject Production Supabase as a valid Staging target', () => {
  const facts = buildStagingEnvironmentFacts({
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'novelrise-preview-123.vercel.app',
    SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co'
  });

  assert.equal(facts.supabase.url, null);
});

test('public route is unavailable in Vercel Production', async () => {
  await withEnvironment({ VERCEL_ENV: 'production' }, () => {
    const res = response();
    handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  });
});

test('public route rejects non-GET methods', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview' }, () => {
    const res = response();
    handler({ method: 'POST' }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  });
});
