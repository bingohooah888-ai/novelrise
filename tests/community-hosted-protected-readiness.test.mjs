import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectProtectedRunnerReadiness } from '../scripts/community-hosted-protected-readiness.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = 'b'.repeat(40);
const TOKEN = 'synthetic-protected-runner-read-token-2026';
const API = 'https://api.github.com/repos/bingohooah888-ai/novelrise';
const commentBody =
  'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ' +
  JSON.stringify({
    confirmation: 'STAGING COST APPROVED',
    featureSha: FEATURE,
    mainSha: MAIN,
    scope: 'community-phase1-hosted-authenticated-write',
    target: 'new-data-less-isolated-branch'
  });

function fixture(overrides = {}) {
  const urls = [];
  const objects = {
    '/git/ref/heads/main': { object: { sha: MAIN } },
    '/pulls/2222': {
      head: { sha: FEATURE },
      base: { sha: MAIN },
      state: 'open',
      draft: true,
      merged: false
    },
    '/actions/runs/456': {
      id: 456,
      event: 'issue_comment',
      head_sha: MAIN,
      head_branch: 'main',
      path: '.github/workflows/community-hosted-executor.yml',
      actor: { login: 'bingohooah888-ai' },
      triggering_actor: { login: 'bingohooah888-ai' },
      run_attempt: 1
    },
    '/issues/188': {
      number: 188,
      state: 'open',
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: 'bingohooah888-ai' }
    },
    '/issues/comments/123': {
      id: 123,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      issue_url: API + '/issues/188',
      body: commentBody
    },
    '/environments/community-hosted-isolated': {
      name: 'community-hosted-isolated',
      prevent_self_review: true,
      can_admins_bypass: false,
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true
      },
      protection_rules: [{
        type: 'required_reviewers',
        reviewers: [{
          type: 'User',
          reviewer: { login: 'independent-reviewer' }
        }]
      }]
    },
    '/environments/community-hosted-isolated/deployment-branch-policies?per_page=100': {
      total_count: 1,
      branch_policies: [{ name: 'main', type: 'branch' }]
    },
    ...overrides
  };
  return {
    urls,
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      const path = url.slice(API.length);
      urls.push(path);
      return {
        status: Object.hasOwn(objects, path) ? 200 : 404,
        json: async () => objects[path]
      };
    }
  };
}

async function inspect(x) {
  return inspectProtectedRunnerReadiness({
    mainSha: MAIN,
    candidateSha: FEATURE,
    commentId: '123',
    runId: '456',
    token: TOKEN,
    fetchImpl: x.fetchImpl
  });
}

test('authenticated environment is read-only and never grants Staging', async () => {
  const x = fixture();
  const result = await inspect(x);
  assert.equal(result.status, 'AUTHENTICATED_PROTECTED_READINESS_ONLY');
  assert.equal(result.githubEnvironmentReadVerified, true);
  assert.equal(result.runAuthorized, false);
  assert.equal(result.stagingCostApproved, false);
  assert.equal(x.urls.length, 7);
});

test('closed issue and candidate SHA drift deny before environment read', async () => {
  const x = fixture({
    '/issues/188': {
      number: 188,
      state: 'closed',
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: 'bingohooah888-ai' }
    }
  });
  await assert.rejects(inspect(x), /PROTECTED_READINESS_DENIED/u);
  assert.ok(!x.urls.some((url) => url.startsWith('/environments/')));

  const y = fixture({
    '/pulls/2222': {
      head: { sha: 'c'.repeat(40) },
      base: { sha: MAIN },
      state: 'open',
      draft: true
    }
  });
  await assert.rejects(inspect(y), /PROTECTED_READINESS_DENIED/u);
});

test('self-review, bypass, or extra branch violates protection', async () => {
  const original = fixture();
  const environment = original;
  assert.equal(environment.urls.length, 0);
  const cases = [
    {
      '/environments/community-hosted-isolated': {
        name: 'community-hosted-isolated',
        prevent_self_review: false,
        can_admins_bypass: false,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true
        },
        protection_rules: []
      }
    },
    {
      '/environments/community-hosted-isolated/deployment-branch-policies?per_page=100': {
        total_count: 2,
        branch_policies: [
          { name: 'main', type: 'branch' },
          { name: 'develop', type: 'branch' }
        ]
      }
    }
  ];
  for (const change of cases) {
    await assert.rejects(
      inspect(fixture(change)),
      /PROTECTED_READINESS_DENIED/u
    );
  }
});

test('workflow replay, identity drift, and missing credentials deny', async () => {
  await assert.rejects(
    inspect(fixture({
      '/actions/runs/456': {
        id: 456,
        event: 'issue_comment',
        head_sha: MAIN,
        head_branch: 'main',
        path: '.github/workflows/community-hosted-executor.yml',
        actor: { login: 'bingohooah888-ai' },
        triggering_actor: { login: 'bingohooah888-ai' },
        run_attempt: 2
      }
    })),
    /PROTECTED_READINESS_DENIED/u
  );
  await assert.rejects(
    inspectProtectedRunnerReadiness({
      mainSha: MAIN,
      candidateSha: FEATURE,
      commentId: '123',
      runId: '456',
      token: '',
      fetchImpl: fixture().fetchImpl
    }),
    /PROTECTED_READINESS_DENIED/u
  );
});
