import assert from 'node:assert/strict';
import test from 'node:test';

import { auditAi020705PaidTrialPlan } from '../scripts/ai-020705-paid-trial-preflight-audit.mjs';

const SHA = 'a'.repeat(40);
const evidence = Object.freeze({
  mainSha: SHA,
  targetSha: SHA,
  previewSha: SHA,
  previewDeploymentId: 'dpl_synthetic123',
  previewReady: true,
  previewIsProduction: false,
  supabaseProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  productionIsolated: true,
  stagingCredentialsOnly: true,
  sourceKind: 'synthetic_non_sensitive',
  ownerVerified: true,
  novelId: 41,
  episodeId: 11,
  chunkIndex: 0,
  provider: 'openai',
  model: 'gpt-5.6-luna',
  routeCount: 1,
  maxProviderCalls: 1,
  fallbackDisabled: true,
  automaticRetryDisabled: true,
  modelAccessVerified: true,
  providerDataTermsVerified: true,
  providerBillingControlsVerified: true,
  sourceRightsVerified: true,
  consentRevisionVerified: true,
  explicitAuthorConsentVerified: true,
  priceVerifiedAtExecution: true,
  fxAndBufferVerified: true,
  estimateMicros: 2528640,
  baselineAiOffAndZero: true,
  budgetCapsMicros: [3000000, 3000000, 3000000, 3000000],
  expiryMinutes: 60,
  approvalScopedToExactTarget: true,
  dedicatedLedgerImplemented: true,
  atomicClaimBeforeSecretsProven: true,
  replayAndParallelRunDenied: true,
  killSwitchAndBudgetResetPlanVerified: true,
  cleanupIncludesUsageAndConsentAudit: true,
  finalCensusProofPlanned: true,
  failuresDoNotAutoRetry: true
});

test('no evidence means NO-GO and never grants execution permission', () => {
  const audit = auditAi020705PaidTrialPlan();
  assert.equal(audit.status, 'NO_GO');
  assert.ok(audit.missingChecks.length > 5);
  assert.equal(audit.authorizesExecution, false);
  assert.equal(audit.mayCallProvider, false);
  assert.equal(audit.mayModifyDatabase, false);
  assert.equal(audit.mayCreatePreview, false);
  assert.ok(Object.isFrozen(audit.missingChecks));
});

test('even hypothetical full evidence is not an execution authorization', () => {
  const result = auditAi020705PaidTrialPlan(evidence);
  assert.equal(result.status, 'READY_FOR_SEPARATE_HUMAN_APPROVAL_ONLY');
  assert.deepEqual(result.missingChecks, []);
  assert.equal(result.authorizesExecution, false);
  assert.equal(result.mayCallProvider, false);
});

test('one-use claim, replay protection or strict call count must not be skipped', () => {
  for (const change of [
    { dedicatedLedgerImplemented: false },
    { atomicClaimBeforeSecretsProven: false },
    { replayAndParallelRunDenied: false },
    { approvalScopedToExactTarget: false },
    { maxProviderCalls: 2 },
    { automaticRetryDisabled: false },
    { fallbackDisabled: false },
    { routeCount: 2 }
  ]) {
    const result = auditAi020705PaidTrialPlan({ ...evidence, ...change });
    assert.equal(result.status, 'NO_GO');
    assert.ok(
      result.missingChecks.some(
        (key) =>
          key === 'separate_single_use_authorization' ||
          key === 'one_provider_one_call'
      )
    );
    assert.equal(result.authorizesExecution, false);
  }
});

test('ten yen total, four scopes and one-hour window are hard boundaries', () => {
  for (const change of [
    { estimateMicros: 10000001 },
    { budgetCapsMicros: [10000001, 10000001, 10000001, 10000001] },
    { budgetCapsMicros: [2500000, 3000000, 3000000, 3000000] },
    { budgetCapsMicros: [3000000] },
    { expiryMinutes: 61 },
    { expiryMinutes: 0 },
    { priceVerifiedAtExecution: false },
    { providerBillingControlsVerified: false }
  ]) {
    const result = auditAi020705PaidTrialPlan({ ...evidence, ...change });
    assert.equal(result.status, 'NO_GO');
  }
});

test('wrong Preview/Supabase/owner/consent and missing cleanup all fail closed', () => {
  for (const change of [
    { targetSha: 'b'.repeat(40) },
    { previewSha: 'b'.repeat(40) },
    { previewReady: false },
    { previewIsProduction: true },
    { supabaseProjectRef: 'fiepaguycecrredwrcwx' },
    { productionIsolated: false },
    { stagingCredentialsOnly: false },
    { sourceKind: 'real_manuscript' },
    { ownerVerified: false },
    { chunkIndex: 1 },
    { explicitAuthorConsentVerified: false },
    { modelAccessVerified: false },
    { killSwitchAndBudgetResetPlanVerified: false },
    { cleanupIncludesUsageAndConsentAudit: false },
    { finalCensusProofPlanned: false }
  ]) {
    assert.equal(
      auditAi020705PaidTrialPlan({ ...evidence, ...change }).status,
      'NO_GO'
    );
  }
});

test('planner never echoes credentials, manuscript, consent text or JWT', () => {
  const marker = 'synthetic-secret-not-a-real-credential';
  const result = auditAi020705PaidTrialPlan({
    ...evidence,
    apiKey: marker,
    jwt: marker,
    manuscript: marker,
    consentText: marker
  });
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.equal(result.mayCallProvider, false);
});
