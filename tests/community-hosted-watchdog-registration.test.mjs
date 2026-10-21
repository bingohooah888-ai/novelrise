import assert from 'node:assert/strict';
import test from 'node:test';

import { registerCommunityWatchBeforeProvisioning } from '../scripts/community-hosted-watchdog-registration.mjs';

const run = {
  repository: 'bingohooah888-ai/novelrise',
  scope: 'community-phase1-hosted-authenticated-write',
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  runId: '456',
  requestCommentId: '123'
};
const grant = {
  ...run,
  status: 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW',
  stagingCostApproved: true,
  runAuthorized: true,
  writeAuthorized: true,
  productionMutationApproved: false,
  protectedEnvironmentVerified: true
};
const claim = {
  ...run,
  status: 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION',
  claimCommentId: '124'
};
const now = Date.parse('2026-10-22T01:00:00.000Z');
const signingKey = 'synthetic-signing-key-long-enough-for-test-2026';
const token = 'synthetic-github-and-supabase-token-long-enough';

function harness({ existing = [], change = {} } = {}) {
  const calls = [];
  let body = null;
  const fixtures = {
    '/git/ref/heads/main': { object: { sha: run.mainSha } },
    '/actions/workflows/community-hosted-expiry-watchdog.yml': {
      id: 78,
      state: 'active',
      path: '.github/workflows/community-hosted-expiry-watchdog.yml'
    },
    '/actions/variables/NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED': {
      name: 'NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED',
      value: 'true'
    },
    '/environments/community-hosted-cleanup': {
      name: 'community-hosted-cleanup',
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true
      },
      protection_rules: []
    },
    '/environments/community-hosted-cleanup/deployment-branch-policies?per_page=100': {
      total_count: 1,
      branch_policies: [{ name: 'main', type: 'branch' }]
    },
    '/actions/workflows/78/runs?event=schedule&branch=main&per_page=20': {
      workflow_runs: [
        {
          id: 90,
          event: 'schedule',
          head_branch: 'main',
          head_sha: run.mainSha,
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-10-22T00:56:00.000Z'
        }
      ]
    },
    '/actions/runs/90/jobs?per_page=100': {
      jobs: [
        {
          name: 'cleanup',
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-10-22T00:57:00.000Z'
        }
      ]
    },
    ...change
  };
  const fetchImpl = async (url, options) => {
    calls.push(options.method);
    if (url.includes('/projects/')) {
      return { status: 200, json: async () => existing };
    }
    const path = url.split('/novelrise')[1];
    if (Object.hasOwn(fixtures, path)) {
      return { status: 200, json: async () => fixtures[path] };
    }
    if (url.includes('/comments?per_page=')) {
      return { status: 200, json: async () => [] };
    }
    if (options.method === 'POST') {
      body = JSON.parse(options.body).body;
      return { status: 201, json: async () => ({ id: 444, body }) };
    }
    return { status: 200, json: async () => ({ id: 444, body }) };
  };
  return { calls, fetchImpl };
}

function execute(h, overrides = {}) {
  return registerCommunityWatchBeforeProvisioning({
    run,
    grant,
    claim,
    signingKey,
    githubToken: token,
    supabaseToken: token,
    now,
    fetchImpl: h.fetchImpl,
    ...overrides
  });
}

test('recent scheduled cleanup is required before registration', async () => {
  const x = harness();
  const receipt = await execute(x);
  assert.equal(receipt.signatureReadBackVerified, true);
  assert.equal(receipt.providerBranchAbsentAtRegistration, true);
  assert.equal(receipt.mayCreateBranch, false);
  assert.equal(x.calls.filter((item) => item === 'POST').length, 1);
});

test('existing run branch blocks registration', async () => {
  const x = harness({ existing: [{ name: 'community-hosted-456' }] });
  await assert.rejects(execute(x), /COMMUNITY_WATCH_REGISTRATION_DENIED/u);
  assert.ok(!x.calls.includes('POST'));
});

test('disabled or blocked cleanup environment denies', async () => {
  const cases = [
    {
      '/actions/variables/NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED': {
        name: 'NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED',
        value: 'false'
      }
    },
    {
      '/environments/community-hosted-cleanup': {
        name: 'community-hosted-cleanup',
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true
        },
        protection_rules: [{ type: 'required_reviewers' }]
      }
    }
  ];
  for (const change of cases) {
    const x = harness({ change });
    await assert.rejects(execute(x), /COMMUNITY_WATCHDOG_LIVE_DENIED/u);
    assert.ok(!x.calls.includes('POST'));
  }
});

test('skipped, stale or drifted run prevents a POST', async () => {
  const cases = [
    {
      '/actions/runs/90/jobs?per_page=100': {
        jobs: [
          {
            name: 'cleanup',
            status: 'completed',
            conclusion: 'skipped',
            completed_at: '2026-10-22T00:57:00.000Z'
          }
        ]
      }
    },
    {
      '/actions/workflows/78/runs?event=schedule&branch=main&per_page=20': {
        workflow_runs: [
          {
            id: 90,
            event: 'schedule',
            head_branch: 'main',
            head_sha: run.mainSha,
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-10-21T23:00:00.000Z'
          }
        ]
      }
    },
    { '/git/ref/heads/main': { object: { sha: 'c'.repeat(40) } } }
  ];
  for (const change of cases) {
    const x = harness({ change });
    await assert.rejects(execute(x), /COMMUNITY_WATCHDOG_LIVE_DENIED/u);
    assert.ok(!x.calls.includes('POST'));
  }
});

test('GitHub 403 blocks signed registration', async () => {
  const x = harness();
  await assert.rejects(
    execute(x, { fetchImpl: async () => ({ status: 403 }) }),
    /COMMUNITY_WATCHDOG_LIVE_DENIED/u
  );
});
