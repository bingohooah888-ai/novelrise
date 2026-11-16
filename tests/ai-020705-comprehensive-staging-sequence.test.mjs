import assert from 'node:assert/strict';
import test from 'node:test';

import { create020705ComprehensiveStagingSequence } from '../.github/staging-ai-02-07-05/comprehensive-staging-sequence.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const STAGING_URL = 'https://' + PROJECT + '.supabase.co';

function fixture({ badPreview = false, badJwt = false, failPaid = false, cleanupFails = false, invalidRefs = false } = {}) {
  const actions = [];
  const scope = Object.freeze({
    repository: 'bingohooah888-ai/novelrise',
    stagingProjectRef: PROJECT,
    supabaseUrl: STAGING_URL,
    protectedEnvironment: 'staging',
    trustedRef: 'refs/heads/main',
    prNumber: 2895,
    mainSha: MAIN,
    candidateSha: HEAD,
    stagingBranch: 'staging/ai-02-07-05-owner-proof',
    approvalCommentId: 700,
    runId: 701,
    maxMigrations: 2,
    maxPreviews: 1,
    maxPaidCalls: 1,
    capMicros: 1000000
  });
  let verified = 0;
  const options = {
    scope,
    async verifyOwnerAndRefs() {
      actions.push('verify-refs');
      verified += 1;
      return !invalidRefs || verified < 3;
    },
    async verifyStagingIsolation() {
      actions.push('verify-isolation');
      return true;
    },
    async installReviewState() {
      actions.push('migration-review');
      return true;
    },
    async installChunkClaim() {
      actions.push('migration-claim');
      return true;
    },
    async preparePreview() {
      actions.push('preview');
      return {
        id: 'dpl_staging123',
        target: 'preview',
        ready: true,
        gitCommitSha: badPreview ? MAIN : HEAD,
        gitBranch: scope.stagingBranch,
        projectRef: PROJECT,
        supabaseUrl: STAGING_URL,
        ssoProtected: true
      };
    },
    async runSyntheticJwtProof() {
      actions.push('real-jwt-proof');
      return {
        verifiedSynthetic: true,
        realSignedJwt: true,
        ownerOnly: true,
        rlsDeniedOtherActor: true,
        revokedSessionDenied: true,
        casConflictDenied: true,
        claimOnceDeniedReplay: !badJwt,
        stagingProjectRef: PROJECT,
        candidateSha: HEAD
      };
    },
    async getProtectedPaidConfig() {
      actions.push('protected-config');
      return {
        context: {
          mainSha: MAIN,
          candidateSha: HEAD,
          previewDeploymentId: 'dpl_staging123'
        },
        expected: {
          candidateSha: HEAD,
          capMicros: scope.capMicros
        },
        synthetic: { projectRef: PROJECT }
      };
    },
    protectedPaidFactory() {
      actions.push('protected-factory');
      return {
        async run() {
          actions.push('one-paid-executor');
          if (failPaid) throw new Error('SECRET_PROVIDER_ERROR');
          return { outcome: 'one_call_succeeded_and_cleanup_verified' };
        }
      };
    },
    async stopAndCleanup() {
      actions.push('emergency-stop-cleanup');
      return !cleanupFails;
    },
    async independentFinalCensus() {
      actions.push('independent-census');
      return true;
    }
  };
  return { scope, options, actions };
}

test('one bounded Staging sequence connects migration, Preview, JWT, paid executor and census', async () => {
  const { options, actions } = fixture();
  const sequence = create020705ComprehensiveStagingSequence(options);
  const result = await sequence.run();
  assert.equal(result.outcome, 'STAGING_SEQUENCE_PASS');
  assert.equal(result.migrationsInstalled, 2);
  assert.equal(result.paidAttempts, 1);
  assert.deepEqual(actions.filter((x) => x.startsWith('migration-')), [
    'migration-review',
    'migration-claim'
  ]);
  for (const [before, after] of [
    ['verify-isolation', 'migration-review'],
    ['migration-review', 'migration-claim'],
    ['migration-claim', 'preview'],
    ['preview', 'real-jwt-proof'],
    ['real-jwt-proof', 'one-paid-executor'],
    ['one-paid-executor', 'independent-census']
  ]) {
    assert.ok(actions.indexOf(before) < actions.indexOf(after));
  }
  assert.equal(actions.includes('emergency-stop-cleanup'), false);
  await assert.rejects(sequence.run(), /AI_020705_STAGING_SEQUENCE_DENIED/u);
  assert.equal(actions.filter((x) => x === 'one-paid-executor').length, 1);
});

test('missing scoped protected adapters, wrong repo or Production abort construction', () => {
  const { options } = fixture();
  assert.throws(
    () => create020705ComprehensiveStagingSequence({
      ...options,
      scope: { ...options.scope, stagingProjectRef: 'fiepaguycecrredwrcwx' }
    }),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
  assert.throws(
    () => create020705ComprehensiveStagingSequence({
      ...options,
      scope: { ...options.scope, maxPaidCalls: 2 }
    }),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
  assert.throws(
    () => create020705ComprehensiveStagingSequence({
      ...options,
      verifyOwnerAndRefs: undefined
    }),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
});

test('approval drift blocks second migration, without Preview, JWT or paid call', async () => {
  const { options, actions } = fixture({ invalidRefs: true });
  const sequence = create020705ComprehensiveStagingSequence(options);
  await assert.rejects(sequence.run(), /AI_020705_STAGING_SEQUENCE_DENIED/u);
  assert.deepEqual(actions.filter((x) => x.startsWith('migration-')), [
    'migration-review'
  ]);
  assert.equal(actions.includes('preview'), false);
  assert.equal(actions.includes('one-paid-executor'), false);
});

test('Preview SHA mismatch prevents synthetic Auth or any paid attempt', async () => {
  const { options, actions } = fixture({ badPreview: true });
  await assert.rejects(
    create020705ComprehensiveStagingSequence(options).run(),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
  assert.equal(actions.includes('real-jwt-proof'), false);
  assert.equal(actions.includes('one-paid-executor'), false);
});

test('JWT proof failure triggers synthetic cleanup without paid call', async () => {
  const { options, actions } = fixture({ badJwt: true });
  await assert.rejects(
    create020705ComprehensiveStagingSequence(options).run(),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
  assert.equal(actions.includes('one-paid-executor'), false);
  assert.ok(actions.includes('emergency-stop-cleanup'));
  assert.ok(actions.includes('independent-census'));
});

test('failed paid provider is sanitized, stopped and never retried', async () => {
  const { options, actions } = fixture({ failPaid: true });
  await assert.rejects(
    create020705ComprehensiveStagingSequence(options).run(),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
  assert.equal(actions.filter((x) => x === 'one-paid-executor').length, 1);
  assert.ok(actions.includes('emergency-stop-cleanup'));
  assert.equal(actions.includes('independent-census'), true);
});

test('cleanup failure prevents PASS even if JWT passed', async () => {
  const { options } = fixture({ badJwt: true, cleanupFails: true });
  await assert.rejects(
    create020705ComprehensiveStagingSequence(options).run(),
    /AI_020705_STAGING_SEQUENCE_DENIED/u
  );
});
