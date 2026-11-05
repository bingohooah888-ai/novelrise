import assert from 'node:assert/strict';
import test from 'node:test';
import { assess020705GateBCReadOnly } from '../scripts/nlo-ai-phase2-gatebc-readonly.mjs';

const SHA = 'a'.repeat(40);
const branch = 'staging/ai-02-07-05-gatebc-20261105';
const scope = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: SHA,
  branch
};
const currentMain = { repository: scope.repository, sha: SHA };
const vercelProject = {
  id: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
  name: 'novelrise',
  ssoProtection: { enabled: true, deploymentType: 'all_except_custom_domains' }
};
const stagingProject = { id: scope.stagingProjectRef };
const names = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_AI_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_020705_ONE_SHOT_ENABLED'
];

test('old branch metadata cannot satisfy new Gate B/C preflight', () => {
  const result = assess020705GateBCReadOnly({
    scope,
    currentMain,
    vercelProject,
    stagingProject,
    envMetadata: names.map((key) => ({
      key,
      target: ['preview'],
      gitBranch: 'staging/ai-02-07-05-old'
    }))
  });
  assert.equal(result.status, 'GATE_BC_NO_GO_LIVE_PROOFS_PENDING');
  assert.equal(result.gateB.missingBranchScopedEnvNames.length, 9);
  assert.ok(result.blockers.includes('BRANCH_SCOPED_PREVIEW_ENV_MISSING'));
  assert.ok(result.blockers.includes('NEW_PREVIEW_REQUIRES_STAGING_APPROVAL'));
  assert.equal(result.authorizesPreviewCreation, false);
  assert.equal(result.authorizesPaidCall, false);
});

test('even full offline evidence cannot authorize live Runner or paid AI', () => {
  const result = assess020705GateBCReadOnly({
    scope,
    currentMain,
    vercelProject,
    stagingProject,
    existingPreview: {
      id: 'dpl_mock123',
      repository: scope.repository,
      projectRef: scope.stagingProjectRef,
      branch,
      sha: SHA,
      state: 'READY',
      target: 'preview'
    },
    envMetadata: names.map((key) => ({
      key,
      target: ['preview'],
      gitBranch: branch,
      value: 'DO_NOT_ECHO_SENSITIVE_INPUT'
    })),
    runnerOfflineResult: {
      status: 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH',
      authorizesExecution: false,
      checks: names.slice(0, 6).map(() => ({ verified: true }))
    }
  });
  assert.equal(result.gateB.missingBranchScopedEnvNames.length, 0);
  assert.equal(
    result.gateC.offlineContractStatus,
    'SIX_OFFLINE_PROOF_CONTRACTS_MATCH'
  );
  assert.equal(result.authorizesPaidCall, false);
  assert.equal(result.authorizesStagingWrite, false);
  assert.ok(result.blockers.includes('PROTECTED_RUNNER_LIVE_NOT_PROVEN'));
  assert.ok(!JSON.stringify(result).includes('DO_NOT_ECHO_SENSITIVE_INPUT'));
});

test('wrong projects never count as valid environment evidence', () => {
  const result = assess020705GateBCReadOnly({
    scope,
    currentMain,
    vercelProject: {
      ...vercelProject,
      id: 'prj_wrong',
      ssoProtection: { enabled: false }
    },
    stagingProject: { id: 'fiepaguycecrredwrcwx' }
  });
  assert.equal(result.gateB.vercelIdentity, false);
  assert.equal(result.gateB.previewSso, false);
  assert.equal(result.gateB.stagingIdentity, false);
  assert.equal(result.authorizesProductionChange, false);
});
