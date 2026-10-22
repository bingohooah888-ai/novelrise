import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';

import { auditCommunityHostedNoCostReadiness } from '../scripts/community-hosted-preapproval-audit.mjs';
import { REVIEWED_COMMUNITY_FILES } from '../scripts/community-phase1-reviewed-candidate.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = 'b'.repeat(40);
const COMMITS = Array.from({ length: 101 }, (_, i) => ({
  sha: i === 100 ? FEATURE : (i + 1).toString(16).padStart(40, '0')
}));
const TOKEN = 'synthetic-readonly-token-long-enough-for-test';
const REPO = 'bingohooah888-ai/novelrise';
const NOW = Date.parse('2026-10-23T00:15:00.000Z');
const ENV = {
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
};
const CLEANUP = {
  ...ENV,
  name: 'community-hosted-cleanup',
  protection_rules: []
};
const POLICY = {
  total_count: 1,
  branch_policies: [{ name: 'main', type: 'branch' }]
};

function harness(overrides = {}) {
  const requests = [];
  const routes = {
    '/git/ref/heads/main': { object: { sha: MAIN } },
    '/pulls/2222': {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { sha: MAIN },
      head: { sha: FEATURE, repo: { full_name: REPO } }
    },
    '/issues/188': { number: 188, state: 'closed' },
    ['/compare/' + MAIN + '...' + FEATURE + '?per_page=100&page=1']: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 101,
      total_commits: 101,
      base_commit: { sha: MAIN },
      commits: COMMITS.slice(0, 100),
      files: REVIEWED_COMMUNITY_FILES.map(({ path, sha, status }) => ({
        filename: path,
        sha,
        status
      }))
    },
    ['/compare/' + MAIN + '...' + FEATURE + '?per_page=100&page=2']: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 101,
      total_commits: 101,
      base_commit: { sha: MAIN },
      commits: COMMITS.slice(100)
    },
    '/environments/community-hosted-isolated': ENV,
    '/environments/community-hosted-isolated/deployment-branch-policies?per_page=100':
      POLICY,
    '/environments/community-hosted-cleanup': CLEANUP,
    '/environments/community-hosted-cleanup/deployment-branch-policies?per_page=100':
      POLICY,
    '/actions/workflows/community-hosted-expiry-watchdog.yml': {
      id: 123,
      state: 'active',
      path: '.github/workflows/community-hosted-expiry-watchdog.yml'
    },
    '/actions/variables/NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED': {
      name: 'NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED',
      value: 'true'
    },
    '/actions/workflows/123/runs?event=schedule&branch=main&per_page=20': {
      workflow_runs: [
        {
          id: 456,
          event: 'schedule',
          head_sha: MAIN,
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-10-23T00:10:00.000Z'
        }
      ]
    },
    '/actions/runs/456/jobs?per_page=100': {
      jobs: [
        {
          name: 'cleanup',
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-10-23T00:11:00.000Z'
        }
      ]
    },
    ...overrides
  };
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
      const path =
        new URL(url).pathname.replace('/repos/' + REPO, '') +
        new URL(url).search;
      const value = routes[path];
      return value === undefined || value === null
        ? { status: 403, json: async () => ({}) }
        : { status: 200, json: async () => value };
    }
  };
}

async function run(scenario) {
  return auditCommunityHostedNoCostReadiness({
    expectedMainSha: MAIN,
    githubToken: TOKEN,
    fetchImpl: scenario.fetchImpl,
    now: NOW
  });
}

test('all GitHub GET checks do not grant billable execution', async () => {
  const sample = harness();
  const result = await run(sample);
  assert.equal(result.checks.trustedMain, true);
  assert.equal(result.checks.candidateReview, true);
  assert.equal(result.checks.independentEnvironment, true);
  assert.equal(result.checks.cleanupEnvironment, true);
  assert.equal(result.checks.watchdogConfigured, true);
  assert.equal(result.checks.recentCleanupJob, true);
  assert.equal(result.checks.costGateClosed, true);
  assert.deepEqual(result.blockers, ['providerBillingAndIsolationUnverified']);
  assert.equal(result.mayClaim, false);
  assert.equal(result.mayCreateBranch, false);
  assert.equal(result.mayDeployPreview, false);
  assert.equal(result.mayRunBrowser, false);
  assert.equal(result.releaseAuthorized, false);
  assert.ok(
    sample.requests.every((item) =>
      item.url.startsWith('https://api.github.com/repos/' + REPO + '/')
    )
  );
});

test('blocked by unreadable environment and disabled watchdog', async () => {
  const sample = harness({
    '/issues/188': { number: 188, state: 'open' },
    '/environments/community-hosted-isolated': null,
    '/actions/variables/NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED': {
      name: 'NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED',
      value: 'false'
    }
  });
  const result = await run(sample);
  assert.equal(result.checks.independentEnvironment, false);
  assert.equal(result.checks.watchdogConfigured, false);
  assert.equal(result.checks.recentCleanupJob, false);
  assert.equal(result.checks.costGateClosed, false);
  assert.equal(result.issue188State, 'open');
  assert.equal(result.stagingCostApproved, false);
});

test('reject changed blobs and nonindependent reviewers', async () => {
  const bad = REVIEWED_COMMUNITY_FILES.map(({ path, sha, status }) => ({
    filename: path,
    sha,
    status
  }));
  bad[0].sha = 'f'.repeat(40);
  const sample = harness({
    ['/compare/' + MAIN + '...' + FEATURE + '?per_page=100&page=1']: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 101,
      total_commits: 101,
      base_commit: { sha: MAIN },
      commits: COMMITS.slice(0, 100),
      files: bad
    },
    '/environments/community-hosted-isolated': {
      ...ENV,
      protection_rules: [
        {
          type: 'required_reviewers',
          reviewers: [
            {
              type: 'User',
              reviewer: { login: 'bingohooah888-ai' }
            }
          ]
        }
      ]
    }
  });
  const result = await run(sample);
  assert.equal(result.checks.candidateReview, false);
  assert.equal(result.checks.independentEnvironment, false);
});

test('reject truncated GitHub compare pagination', async () => {
  const sample = harness({
    ['/compare/' + MAIN + '...' + FEATURE + '?per_page=100&page=2']: null
  });
  const result = await run(sample);
  assert.equal(result.checks.candidateReview, false);
  assert.ok(
    sample.requests.some((request) => request.url.includes('page=2'))
  );
  assert.equal(result.mayRunBrowser, false);
});

test('reject drifted metadata on a later comparison page', async () => {
  const sample = harness({
    ['/compare/' + MAIN + '...' + FEATURE + '?per_page=100&page=2']: {
      status: 'ahead',
      behind_by: 1,
      ahead_by: 101,
      total_commits: 101,
      base_commit: { sha: MAIN },
      commits: COMMITS.slice(100)
    }
  });
  const result = await run(sample);
  assert.equal(result.checks.candidateReview, false);
});

test('reject a short first page despite claiming 101 commits', async () => {
  const sample = harness({
    ['/compare/' + MAIN + '...' + FEATURE + '?per_page=100&page=1']: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 101,
      total_commits: 101,
      base_commit: { sha: MAIN },
      commits: COMMITS.slice(0, 99),
      files: REVIEWED_COMMUNITY_FILES.map(({ path, sha, status }) => ({
        filename: path,
        sha,
        status
      }))
    }
  });
  assert.equal((await run(sample)).checks.candidateReview, false);
});

test('invalid trusted input prevents network requests', async () => {
  let requests = 0;
  await assert.rejects(
    () =>
      auditCommunityHostedNoCostReadiness({
        expectedMainSha: 'wrong',
        githubToken: TOKEN,
        fetchImpl: async () => {
          requests += 1;
          throw Error('never call');
        }
      }),
    /COMMUNITY_PREAPPROVAL_READ_DENIED/u
  );
  assert.equal(requests, 0);
});
