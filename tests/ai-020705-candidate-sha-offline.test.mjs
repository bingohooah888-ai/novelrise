import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspect020705PreviewPrecreation,
  inspect020705CandidateStagingOffline
} from '../.github/staging-ai-02-07-05/preview-precreation-readonly.mjs';

const MAIN = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const BRANCH = 'staging/ai-02-07-05-candidate-20261110';
const REPOSITORY = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const PREVIEW = 'dpl_synthetic123';
const NOW = Date.parse('2026-11-10T12:00:00Z');
const keys = [
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

function setup() {
  const scope = {
    repository: REPOSITORY,
    stagingProjectRef: STAGING,
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    branch: BRANCH
  };
  const existingPreview = {
    id: PREVIEW,
    repository: REPOSITORY,
    projectRef: STAGING,
    branch: BRANCH,
    sha: CANDIDATE,
    state: 'READY',
    target: 'preview'
  };
  const shared = {
    repository: REPOSITORY,
    stagingProjectRef: STAGING,
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    branch: BRANCH,
    previewDeploymentId: PREVIEW,
    approvalCommentId: 700,
    runId: 1001,
    actorId: '11111111-1111-4111-8111-111111111111',
    novelId: 41,
    episodeId: 11,
    expiresAt: new Date(NOW + 300000).toISOString()
  };
  return {
    scope,
    currentMain: { repository: REPOSITORY, sha: MAIN },
    stagingBranchHeadSha: CANDIDATE,
    existingPreview,
    envMetadata: keys.map((key) => ({
      key,
      gitBranch: BRANCH,
      target: ['preview']
    })),
    ownerIntent: {
      ...shared,
      ownerLogin: 'bingohooah888-ai',
      approvalIssueNumber: 294,
      actorId: '11111111-1111-4111-8111-111111111111',
      novelId: 41,
      episodeId: 11,
      capMicros: 10000000,
      expiresAt: new Date(NOW + 300000).toISOString()
    },
    watchdogPlan: {
      ...shared,
      capMicros: 10000000,
      independentHostRequired: true,
      stopAndRevokeRequired: true,
      independentZeroCensusRequired: true,
      stopOnTimeoutRequired: true
    },
    budget: {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      currency: 'JPY',
      capMicros: 10000000,
      maxPosts: 1,
      noRetry: true,
      maxDurationMinutes: 60
    },
    now: () => NOW
  };
}

test('base main and candidate SHA are checked separately and do not authorize execution', () => {
  const p = setup();
  const x = inspect020705CandidateStagingOffline(p);
  assert.equal(x.baseMainSha, MAIN);
  assert.equal(x.candidateSha, CANDIDATE);
  assert.equal(
    x.status,
    'CANDIDATE_SCOPE_METADATA_MATCHES_LIVE_PROOFS_REQUIRED'
  );
  assert.equal(x.preview.expectedMainSha, MAIN);
  assert.equal(x.preview.expectedCandidateSha, CANDIDATE);
  assert.equal(x.preview.expectedPreviewSha, CANDIDATE);
  assert.equal(x.preview.branchHeadMatchesMain, false);
  assert.equal(x.preview.branchHeadMatchesTarget, true);
  assert.equal(x.ownerApprovalAuthenticated, false);
  assert.equal(x.independentStopVerified, false);
  assert.equal(x.billingEntitlementVerified, false);
  assert.equal(x.protectedRunnerWired, false);
  assert.equal(x.authorizesExecution, false);
  assert.equal(x.authorizesPreviewCreation, false);
  assert.equal(x.authorizesStagingWrite, false);
  assert.equal(x.authorizesPaidCall, false);
  assert.equal(x.authorizesMutation, false);
});

test('existing main-only checker remains unchanged for legacy mode', () => {
  const p = setup();
  const x = inspect020705PreviewPrecreation({
    scope: { ...p.scope, candidateSha: undefined, mainSha: MAIN },
    currentMain: p.currentMain,
    stagingBranchHeadSha: MAIN,
    existingPreview: { ...p.existingPreview, sha: MAIN },
    envMetadata: p.envMetadata
  });
  assert.equal(
    x.status,
    'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL'
  );
  assert.equal(x.expectedCandidateSha, null);
  assert.equal(x.expectedPreviewSha, MAIN);
  assert.equal(x.branchHeadMatchesMain, true);
  assert.equal(x.branchHeadMatchesTarget, true);
  assert.equal(x.authorizesPaidCall, false);
});

test('stale branch and mismatching candidate Preview produce NO-GO', () => {
  const a = setup();
  a.stagingBranchHeadSha = MAIN;
  const stale = inspect020705CandidateStagingOffline(a);
  assert.equal(stale.status, 'CANDIDATE_SCOPE_PRECONDITIONS_NO_GO');
  assert.equal(stale.preview.status, 'STAGING_BRANCH_SHA_MISMATCH');

  const b = setup();
  b.existingPreview.sha = MAIN;
  const wrong = inspect020705CandidateStagingOffline(b);
  assert.equal(wrong.status, 'CANDIDATE_SCOPE_PRECONDITIONS_NO_GO');
  assert.equal(wrong.preview.status, 'EXISTING_PREVIEW_SHA_MISMATCH');
});

test('shared Preview credentials do not become verified Staging-only secrets', () => {
  const p = setup();
  p.envMetadata = p.envMetadata.filter((x) => x.key !== 'SUPABASE_SECRET_KEY');
  p.envMetadata.push({ key: 'SUPABASE_SECRET_KEY', target: ['preview'] });
  const x = inspect020705CandidateStagingOffline(p);
  assert.equal(x.status, 'CANDIDATE_SCOPE_PRECONDITIONS_NO_GO');
  assert.deepEqual(x.preview.sharedCredentialsNeedingIsolationProof, [
    'SUPABASE_SECRET_KEY'
  ]);
  assert.equal(x.authorizesStagingWrite, false);
});

test('Owner intent must bind main and candidate separately, including Preview, run and costs', () => {
  for (const corrupt of [
    (p) => {
      p.ownerIntent.mainSha = CANDIDATE;
    },
    (p) => {
      p.ownerIntent.candidateSha = MAIN;
    },
    (p) => {
      p.ownerIntent.previewDeploymentId = 'dpl_other';
    },
    (p) => {
      p.ownerIntent.ownerLogin = 'untrusted';
    },
    (p) => {
      p.ownerIntent.approvalIssueNumber = 295;
    },
    (p) => {
      p.ownerIntent.runId = 1002;
    },
    (p) => {
      p.ownerIntent.capMicros = 5000000;
    },
    (p) => {
      p.ownerIntent.expiresAt = new Date(NOW - 1).toISOString();
    },
    (p) => {
      p.scope.mainSha = CANDIDATE;
    },
    (p) => {
      p.currentMain.sha = CANDIDATE;
    }
  ]) {
    const p = setup();
    corrupt(p);
    assert.throws(
      () => inspect020705CandidateStagingOffline(p),
      /AI_020705_CANDIDATE_SCOPE_DENIED/u
    );
  }
});

test('stopping scope is bound to the same candidate, Owner and monetary ceiling', () => {
  for (const corrupt of [
    (p) => {
      p.watchdogPlan.candidateSha = MAIN;
    },
    (p) => {
      p.watchdogPlan.approvalCommentId = 702;
    },
    (p) => {
      p.watchdogPlan.actorId = '22222222-2222-4222-8222-222222222222';
    },
    (p) => {
      p.watchdogPlan.novelId = 99;
    },
    (p) => {
      p.watchdogPlan.expiresAt = new Date(NOW + 120000).toISOString();
    },
    (p) => {
      p.watchdogPlan.independentHostRequired = false;
    },
    (p) => {
      p.watchdogPlan.independentZeroCensusRequired = false;
    },
    (p) => {
      p.watchdogPlan.stopOnTimeoutRequired = false;
    },
    (p) => {
      p.watchdogPlan.capMicros = 10000001;
    },
    (p) => {
      p.budget.capMicros = 10000001;
    },
    (p) => {
      p.budget.maxPosts = 2;
    },
    (p) => {
      p.budget.noRetry = false;
    },
    (p) => {
      p.budget.maxDurationMinutes = 90;
    }
  ]) {
    const p = setup();
    corrupt(p);
    assert.throws(
      () => inspect020705CandidateStagingOffline(p),
      /AI_020705_CANDIDATE_SCOPE_DENIED/u
    );
  }
});

test('Production, missing Owner or missing Preview are always denied', () => {
  for (const corrupt of [
    (p) => {
      p.scope.stagingProjectRef = 'fiepaguycecrredwrcwx';
    },
    (p) => {
      p.ownerIntent = null;
    },
    (p) => {
      p.existingPreview = null;
    },
    (p) => {
      p.scope.candidateSha = MAIN;
    }
  ]) {
    const p = setup();
    corrupt(p);
    assert.throws(
      () => inspect020705CandidateStagingOffline(p),
      /AI_020705_CANDIDATE_SCOPE_DENIED/u
    );
  }
});
