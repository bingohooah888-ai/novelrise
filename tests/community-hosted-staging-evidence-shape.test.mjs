import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectCommunityHostedStagingEvidenceShape
} from '../scripts/community-hosted-staging-evidence-shape.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';

function fixture() {
  const run = {
    repository: 'bingohooah888-ai/novelrise',
    scope: 'community-phase1-hosted-authenticated-write',
    mainSha: MAIN,
    candidateSha: FEATURE,
    requestCommentId: '123',
    runId: '456'
  };
  return {
    run,
    environment: {
      name: 'community-hosted-isolated',
      prevent_self_review: true,
      can_admins_bypass: false,
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true
      },
      protection_rules: [
        {
          type: 'required_reviewers',
          reviewers: [
            {
              type: 'User',
              reviewer: { login: 'independent-reviewer' }
            }
          ]
        }
      ]
    },
    branchPolicies: {
      total_count: 1,
      branch_policies: [{ name: 'main', type: 'branch' }]
    },
    ownerBudget: {
      requestCommentId: '123',
      runId: '456',
      mainSha: MAIN,
      candidateSha: FEATURE,
      currency: 'JPY',
      maxTotalMinor: 500
    },
    providerLimits: {
      requestCommentId: '123',
      runId: '456',
      currency: 'JPY',
      supabase: {
        provider: 'supabase',
        enforcement: 'provider-hard-stop',
        maxMinor: 300
      },
      vercel: {
        provider: 'vercel',
        enforcement: 'provider-hard-stop',
        maxMinor: 200
      }
    },
    isolationPlan: {
      mode: 'ephemeral-data-less-branch',
      parentProjectRef: 'fiepaguycecrredwrcwx',
      branchName: 'community-hosted-456',
      persistent: false,
      withData: false,
      isDefault: false,
      projectRef: null,
      productionMutationAllowed: false,
      sharedStagingMutationAllowed: false
    }
  };
}

function denied(mutator) {
  const input = fixture();
  mutator(input);
  assert.throws(
    () => inspectCommunityHostedStagingEvidenceShape(input),
    /COMMUNITY_HOSTED_EVIDENCE_SHAPE_DENIED/u
  );
}

test('valid shape remains read-only and creates no runtime authority', () => {
  const receipt = inspectCommunityHostedStagingEvidenceShape(fixture());
  assert.equal(
    receipt.status,
    'READ_ONLY_UNAUTHENTICATED_EVIDENCE_SHAPE_ONLY'
  );
  assert.ok(Object.isFrozen(receipt));
  assert.equal(receipt.mainSha, MAIN);
  assert.equal(receipt.candidateSha, FEATURE);
  for (const key of [
    'evidenceAuthenticated',
    'githubEnvironmentLiveVerified',
    'providerHardStopLiveVerified',
    'ownerApprovalLedgerLiveVerified',
    'isolationCreated',
    'cleanupVerified',
    'exclusiveRunVerified',
    'stagingCostApproved',
    'mayClaim',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(receipt[key], false, key);
  }
});

test('owner self-review, bypass and permissive branches are denied', () => {
  denied((x) => {
    x.environment.prevent_self_review = false;
  });
  denied((x) => {
    x.environment.can_admins_bypass = true;
  });
  denied((x) => {
    x.environment.protection_rules[0].reviewers[0].reviewer.login =
      'bingohooah888-ai';
  });
  denied((x) => {
    x.environment.deployment_branch_policy.custom_branch_policies = false;
  });
  denied((x) => {
    x.branchPolicies.branch_policies[0].name = 'feature';
  });
  denied((x) => {
    x.branchPolicies.total_count = 2;
  });
});

test('missing provider hard limits and budget overruns are denied', () => {
  denied((x) => {
    delete x.ownerBudget.maxTotalMinor;
  });
  denied((x) => {
    x.ownerBudget.requestCommentId = '999';
  });
  denied((x) => {
    x.providerLimits.supabase.enforcement = 'warning-only';
  });
  denied((x) => {
    x.providerLimits.vercel.maxMinor = 201;
  });
  denied((x) => {
    x.providerLimits.runId = '999';
  });
});

test('Production, shared Staging, with-data and persistent plans denied', () => {
  denied((x) => {
    x.isolationPlan.withData = true;
  });
  denied((x) => {
    x.isolationPlan.persistent = true;
  });
  denied((x) => {
    x.isolationPlan.isDefault = true;
  });
  denied((x) => {
    x.isolationPlan.parentProjectRef = 'wmlzjgvxgoyrovdhbqbg';
  });
  denied((x) => {
    x.isolationPlan.branchName = 'community-hosted-999';
  });
  denied((x) => {
    x.isolationPlan.projectRef = 'cccccccccccccccccccc';
  });
});

test('wrong repository, run identity and candidate are denied', () => {
  denied((x) => {
    x.run.repository = 'other/project';
  });
  denied((x) => {
    x.run.runId = '999';
  });
  denied((x) => {
    x.run.candidateSha = 'b'.repeat(40);
  });
});
