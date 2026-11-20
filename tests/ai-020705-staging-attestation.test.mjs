import assert from 'node:assert/strict';
import test from 'node:test';
import { create020705StagingAttestationHandler } from '../api/ai-020705-staging-attestation.js';

const SHA = 'a'.repeat(40);
// prettier-ignore
const ENV = {
  VERCEL_ENV: 'preview',
  NOVELIGHT_AI_020705_STAGING_PREVIEW_ENABLED: 'true',
  SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
  VERCEL_GIT_COMMIT_SHA: SHA
};

// prettier-ignore
function run(env, method = 'GET') {
  const response = {
    statusCode: null, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  create020705StagingAttestationHandler(env)({ method }, response);
  return response;
}

// prettier-ignore
test('exact isolated Staging Preview reveals only non-secret SHA and URL', () => {
  const result = run(ENV);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(Object.keys(result.body).sort(),
    ['commitSha', 'supabaseUrl', 'target']);
  assert.equal(result.body.commitSha, SHA);
  assert.equal(result.body.target, 'preview');
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

// prettier-ignore
test('Production, normal Preview, other Supabase and POST deny attestation', () => {
  for (const env of [
    { ...ENV, VERCEL_ENV: 'production' },
    { ...ENV, NOVELIGHT_AI_020705_STAGING_PREVIEW_ENABLED: 'false' },
    { ...ENV, SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co' },
    { ...ENV, VERCEL_GIT_COMMIT_SHA: 'invalid' }
  ]) {
    assert.equal(run(env).statusCode, 404);
  }
  assert.equal(run(ENV, 'POST').statusCode, 404);
});
