import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyHighRiskPaths,
  isHighRiskPath
} from '../scripts/high-risk-approval-lib.mjs';

test('Production and Staging mutation-control workflows require explicit high-risk approval', () => {
  assert.equal(
    isHighRiskPath('.github/workflows/supabase-production.yml'),
    true
  );
  assert.equal(
    isHighRiskPath('.github/workflows/supabase-production-auto-deploy.yml'),
    true
  );
  assert.equal(
    isHighRiskPath('.github/workflows/supabase-staging-sync-request.yml'),
    true
  );
  assert.equal(
    isHighRiskPath('.github/workflows/supabase-staging-sync.yml'),
    true
  );
  assert.equal(
    isHighRiskPath('.github/workflows/vercel-admin-allowlist.yml'),
    true
  );
  assert.equal(isHighRiskPath('scripts/vercel-admin-allowlist.mjs'), true);
  assert.equal(isHighRiskPath('.github/workflows/staging-smoke.yml'), false);

  assert.deepEqual(
    classifyHighRiskPaths([
      '.github/workflows/staging-smoke.yml',
      '.github/workflows/supabase-production.yml',
      '.github/workflows/supabase-production-auto-deploy.yml',
      '.github/workflows/supabase-staging-sync-request.yml',
      '.github/workflows/supabase-staging-sync.yml',
      '.github/workflows/vercel-admin-allowlist.yml',
      'scripts/vercel-admin-allowlist.mjs'
    ]),
    [
      '.github/workflows/supabase-production-auto-deploy.yml',
      '.github/workflows/supabase-production.yml',
      '.github/workflows/supabase-staging-sync-request.yml',
      '.github/workflows/supabase-staging-sync.yml',
      '.github/workflows/vercel-admin-allowlist.yml',
      'scripts/vercel-admin-allowlist.mjs'
    ]
  );
});
