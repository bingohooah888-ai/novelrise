import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyHighRiskPaths,
  highRiskApprovalChallenge,
  highRiskApprovalCommentMatches,
  isHighRiskPath,
  parseHighRiskApprovalComment
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
    isHighRiskPath('.github/workflows/staging-base-books-32-recovery.yml'),
    true
  );
  assert.equal(
    isHighRiskPath('scripts/staging-base-books-32-recover.mjs'),
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
      '.github/workflows/staging-base-books-32-recovery.yml',
      '.github/workflows/supabase-production.yml',
      '.github/workflows/supabase-production-auto-deploy.yml',
      '.github/workflows/supabase-staging-sync-request.yml',
      '.github/workflows/supabase-staging-sync.yml',
      '.github/workflows/vercel-admin-allowlist.yml',
      'scripts/staging-base-books-32-recover.mjs',
      'scripts/vercel-admin-allowlist.mjs'
    ]),
    [
      '.github/workflows/staging-base-books-32-recovery.yml',
      '.github/workflows/supabase-production-auto-deploy.yml',
      '.github/workflows/supabase-production.yml',
      '.github/workflows/supabase-staging-sync-request.yml',
      '.github/workflows/supabase-staging-sync.yml',
      '.github/workflows/vercel-admin-allowlist.yml',
      'scripts/staging-base-books-32-recover.mjs',
      'scripts/vercel-admin-allowlist.mjs'
    ]
  );
});

test('Production scope is bound into the high-risk approval challenge', () => {
  const pr = 812;
  const headSha = 'a'.repeat(40);
  const mergeOnly = highRiskApprovalChallenge(pr, headSha);
  const migration = highRiskApprovalChallenge(
    pr,
    headSha,
    'supabase-migration-deploy'
  );

  assert.match(mergeOnly, /^[A-F0-9]{8}$/);
  assert.match(migration, /^[A-F0-9]{8}$/);
  assert.notEqual(mergeOnly, migration);
  assert.equal(
    migration,
    highRiskApprovalChallenge(pr, headSha, ['supabase-migration-deploy'])
  );
});

test('scoped high-risk approval parser preserves exact canonical Production scope', () => {
  const pr = 812;
  const headSha = 'b'.repeat(40);
  const productionScopes = ['supabase-migration-deploy'];
  const challenge = highRiskApprovalChallenge(pr, headSha, productionScopes);
  const body = `NOVELIGHT_HIGH_RISK_APPROVE ${JSON.stringify({
    operation: 'merge-high-risk-pr',
    pr,
    headSha,
    challenge,
    productionScopes
  })}`;

  assert.deepEqual(parseHighRiskApprovalComment(body), {
    operation: 'merge-high-risk-pr',
    pr,
    headSha,
    challenge,
    productionScopes
  });
  assert.equal(
    highRiskApprovalCommentMatches(body, {
      pr,
      headSha,
      challenge,
      productionScopes
    }),
    true
  );
});

test('unsupported or non-canonical Production scopes fail closed', () => {
  const pr = 812;
  const headSha = 'c'.repeat(40);
  const challenge = highRiskApprovalChallenge(pr, headSha);

  assert.equal(
    parseHighRiskApprovalComment(
      `NOVELIGHT_HIGH_RISK_APPROVE ${JSON.stringify({
        operation: 'merge-high-risk-pr',
        pr,
        headSha,
        challenge,
        productionScopes: ['unknown-production-operation']
      })}`
    ),
    null
  );

  assert.equal(
    parseHighRiskApprovalComment(
      `NOVELIGHT_HIGH_RISK_APPROVE ${JSON.stringify({
        operation: 'merge-high-risk-pr',
        pr,
        headSha,
        challenge,
        productionScopes: [
          'supabase-migration-deploy',
          'supabase-migration-deploy'
        ]
      })}`
    ),
    null
  );
});
