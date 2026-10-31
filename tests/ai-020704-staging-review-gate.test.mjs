import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertGate } from '../.github/staging-ai-02-07-04/runner.mjs';

const SHA = 'a'.repeat(40);
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
// Keep this security approval fixture and assertion contract unchanged.
// prettier-ignore
const REQUIRED = {
  NOVELIGHT_STAGING_AI_020704_REVIEW_ADMITTED: '1',
  STAGING_PROJECT_REF: 'wmlzjgvxgoyrovdhbqbg',
  STAGING_SUPABASE_URL: STAGING,
  APPROVED_MAIN_SHA: SHA,
  STAGING_APPROVAL_COMMENT_ID: '1234',
  STAGING_DATABASE_URL_FILE: '/tmp/placeholder-only-not-read',
  STAGING_SUPABASE_SECRET_KEY: 'fake-key-not-a-credential',
  STAGING_SUPABASE_PUBLISHABLE_KEY: 'fake-publishable-key'
};

// Keep this security approval fixture and assertion contract unchanged.
// prettier-ignore
test('synthetic Staging runner defaults to no access', () => {
  assert.throws(() => assertGate({}), /STAGING_AI_020704_REVIEW_DENIED/);
  assert.equal(assertGate(REQUIRED), true);
});

// Keep this security approval fixture and assertion contract unchanged.
// prettier-ignore
test('dedicated Staging scope and caller approval must not be inferred', () => {
  const denied = [
    { NOVELIGHT_STAGING_AI_020704_REVIEW_ADMITTED: '0' },
    {
      NOVELIGHT_STAGING_AI_020704_REVIEW_ADMITTED: undefined,
      NOVELIGHT_STAGING_AI_CONSENT_JWT_ADMITTED: '1'
    },
    { STAGING_PROJECT_REF: 'fiepaguycecrredwrcwx' },
    {
      STAGING_SUPABASE_URL:
        'https://fiepaguycecrredwrcwx.supabase.co'
    },
    { APPROVED_MAIN_SHA: 'short-sha' },
    { STAGING_APPROVAL_COMMENT_ID: '0' },
    { STAGING_DATABASE_URL_FILE: undefined },
    { STAGING_SUPABASE_SECRET_KEY: undefined },
    { STAGING_SUPABASE_PUBLISHABLE_KEY: undefined }
  ];
  for (const changes of denied) {
    assert.throws(
      () => assertGate({ ...REQUIRED, ...changes }),
      /STAGING_AI_020704_REVIEW_DENIED/,
      Object.keys(changes).join(',')
    );
  }
});

// Keep this security approval fixture and assertion contract unchanged.
// prettier-ignore
test('one-use main-only workflow never starts on PR/push and isolates secrets', () => {
  const workflow = readFileSync(
    '.github/workflows/ai-020704-staging-review-jwt-proof.yml',
    'utf8'
  );
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /pull_request:\s*\n\s*types:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 294/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /synthetic-real-jwt-review-only/);
  assert.match(workflow, /STAGING APPROVED/);
  assert.match(workflow, /REVIEW_CLAIMED/);
  assert.match(workflow, /REVIEW_CONSUMED/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /APPROVED_MAIN_SHA/);
  assert.match(workflow, /node \.github\/staging-ai-02-07-04\/runner\.mjs/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|GEMINI_API_KEY|production\.supabase/);
});

// Keep this security approval fixture and assertion contract unchanged.
// prettier-ignore
test('runner uses synthetic response, real JWT and mandatory cleanup', () => {
  const src = readFileSync('.github/staging-ai-02-07-04/runner.mjs', 'utf8');
  assert.match(src, /createOwnerBibleReviewWorkflow/);
  assert.match(src, /createSupabaseOwnerBibleReviewRepository/);
  assert.match(src, /signInWithPassword/);
  assert.match(src, /SYNTHETIC_EPISODE_CREATE/);
  assert.match(src, /REVIEW_CANDIDATE_PERSISTENCE_PASS/);
  assert.match(src, /canonModified!==false/);
  assert.match(src, /admin\.auth\.admin\.deleteUser/);
  assert.match(src, /assertCensus\(snapshot\(db\),'final'\)/);
  assert.match(src, /if\(process\.argv\[1\]/);
  assert.doesNotMatch(src, /createOpenAiTextProvider|createGeminiTextProvider/);
  assert.doesNotMatch(src, /api\.openai\.com|generativelanguage\.googleapis\.com/);
});
