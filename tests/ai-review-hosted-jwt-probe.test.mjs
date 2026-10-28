import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateHostedJwtProofConfig
} from '../scripts/ai-review-hosted-jwt-probe.mjs';

function sample() {
  return {
    NOVELIGHT_HOSTED_JWT_ADMITTED: '1',
    STAGING_PROJECT_REF: 'wmlzjgvxgoyrovdhbqbg',
    NOVELIGHT_HOSTED_TEST_USER_ID: '00000000-0000-4000-8000-000000000943',
    NOVELIGHT_HOSTED_TEST_USER_EMAIL: 'ai-review-jwt@example.invalid',
    NOVELIGHT_HOSTED_TEST_NOVEL_ID: '998891003',
    NOVELIGHT_HOSTED_TEST_USER_PASSWORD: 'not-a-real-test-secret',
    VERCEL_AUTOMATION_BYPASS_SECRET: 'not-a-real-bypass',
    APPROVED_MAIN_SHA: 'a'.repeat(40),
    APPROVED_CANDIDATE_SHA: 'b'.repeat(40),
    APPROVED_PREVIEW_SHA: 'b'.repeat(40),
    STAGING_APPROVAL_COMMENT_ID: '70001',
    NOVELIGHT_HOSTED_PREVIEW_URL: 'https://isolated-preview.vercel.app/'
  };
}

test('valid isolated JWT proof config yields only nonsecret pins', () => {
  const config = validateHostedJwtProofConfig(sample());
  assert.equal(config.stage, 'https://wmlzjgvxgoyrovdhbqbg.supabase.co');
  assert.equal(config.novelId, 998891003);
  assert.equal(config.preview, 'https://isolated-preview.vercel.app');
  assert.equal(Object.isFrozen(config), true);
  assert.equal(JSON.stringify(config).includes('not-a-real'), false);
});

for (const field of [
  'NOVELIGHT_HOSTED_JWT_ADMITTED',
  'NOVELIGHT_HOSTED_TEST_USER_PASSWORD',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'APPROVED_PREVIEW_SHA',
  'STAGING_APPROVAL_COMMENT_ID'
]) {
  test('hosted JWT proof rejects missing ' + field, () => {
    const entry = sample();
    delete entry[field];
    assert.throws(
      () => validateHostedJwtProofConfig(entry),
      /AI_HOSTED_JWT_PROOF_DENIED/u
    );
  });
}

test('hosted JWT proof rejects production or foreign staging', () => {
  const entry = sample();
  entry.STAGING_PROJECT_REF = 'fiepaguycecrredwrcwx';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

test('hosted JWT proof rejects Preview mismatched to approved candidate', () => {
  const entry = sample();
  entry.APPROVED_PREVIEW_SHA = 'c'.repeat(40);
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

test('hosted JWT proof rejects arbitrary or production URL', () => {
  const entry = sample();
  entry.NOVELIGHT_HOSTED_PREVIEW_URL = 'https://novelight.example.com/';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
  entry.NOVELIGHT_HOSTED_PREVIEW_URL =
    'https://isolated-preview.vercel.app/secret';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});

test('hosted JWT proof rejects any real or alternate user', () => {
  const entry = sample();
  entry.NOVELIGHT_HOSTED_TEST_USER_ID =
    '00000000-0000-4000-8000-000000000941';
  assert.throws(
    () => validateHostedJwtProofConfig(entry),
    /AI_HOSTED_JWT_PROOF_DENIED/u
  );
});
