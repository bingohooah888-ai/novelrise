import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyHighRiskPaths,
  isHighRiskPath
} from '../scripts/high-risk-approval-lib.mjs';

test('Supabase Production workflows require explicit high-risk approval', () => {
  assert.equal(
    isHighRiskPath('.github/workflows/supabase-production.yml'),
    true
  );
  assert.equal(
    isHighRiskPath('.github/workflows/supabase-production-auto-deploy.yml'),
    true
  );
  assert.equal(isHighRiskPath('.github/workflows/staging-smoke.yml'), false);

  assert.deepEqual(
    classifyHighRiskPaths([
      '.github/workflows/staging-smoke.yml',
      '.github/workflows/supabase-production.yml',
      '.github/workflows/supabase-production-auto-deploy.yml'
    ]),
    [
      '.github/workflows/supabase-production-auto-deploy.yml',
      '.github/workflows/supabase-production.yml'
    ]
  );
});
