import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldIgnoreProductionBuild } from '../scripts/vercel-ignore-build.mjs';

const isolatedPromotionPaths = [
  '.github/staging-ai-proof/runner.sh',
  '.github/staging-ai-proof/census.mjs',
  '.github/staging-ai-proof/admission.mjs',
  '.github/staging-ai-proof/README.md',
  '.github/workflows/ai-review-hosted-staging-race-proof.yml',
  'tests/ai-review-hosted-proof-admission.test.mjs',
  'tests/ai-review-hosted-proof-census.test.mjs',
  'tests/ai-review-hosted-runner-safety.test.mjs',
  'tests/ai-review-trusted-main-promotion-build-guard.test.mjs'
];

test('isolated workflow promotion stays in ignore-build allowlist', () => {
  assert.equal(
    shouldIgnoreProductionBuild({
      environment: 'production',
      ref: 'main',
      changedPaths: isolatedPromotionPaths
    }),
    true
  );
});

test('Vercel ignore-build fails open for missing diff or runtime code', () => {
  for (const changedPaths of [
    [],
    ['scripts/ai-review-hosted-proof-runner.sh'],
    ['vercel.json'],
    ['api/ai-owner-bible-review.js']
  ]) {
    assert.equal(
      shouldIgnoreProductionBuild({
        environment: 'production',
        ref: 'main',
        changedPaths
      }),
      false
    );
  }
});
