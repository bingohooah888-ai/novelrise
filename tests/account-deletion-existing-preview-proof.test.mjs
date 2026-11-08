import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveExistingStagingPreview } from '../scripts/resolve-existing-staging-preview.mjs';

const SHA = 'a'.repeat(40);
const BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const PROJECT_ID = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';

function context(overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
    STAGING_TRIGGER: 'approval_comment',
    STAGING_DELETE_FREE_MODE: 'true',
    STAGING_FREE_APPROVAL_SCOPE: 'account-deletion-free-proof',
    STAGING_PREVIEW_REF: BRANCH,
    EXPECTED_REVISION: SHA,
    VERCEL_API_TOKEN: 'fake-vercel-key-for-mocked-test',
    ...overrides
  };
}

function deployment(overrides = {}) {
  return {
    id: 'dpl_test',
    state: 'READY',
    target: 'preview',
    projectId: PROJECT_ID,
    url: 'novelrise-candidate-123.vercel.app',
    meta: {
      githubCommitSha: SHA,
      githubCommitRef: BRANCH,
      githubRepo: 'novelrise',
      githubOrg: 'bingohooah888-ai'
    },
    ...overrides
  };
}

function resolver(items, pagination = {}) {
  const requests = [];
  return {
    requests,
    resolveScope: async () => ({
      projectId: PROJECT_ID,
      teamId: 'team_2XFgtRCPJQ6pbrEa4mOLQAEx'
    }),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({ deployments: items, pagination })
      };
    }
  };
}

test('Free proof discovers existing READY exact-SHA owned candidate Preview by GET only', async () => {
  const mock = resolver([deployment()]);
  const result = await resolveExistingStagingPreview({
    env: context(),
    fetchImpl: mock.fetchImpl,
    resolveScope: mock.resolveScope
  });
  assert.deepEqual(result, {
    source: 'existing-deployment',
    origin: 'https://novelrise-candidate-123.vercel.app'
  });
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].options.method, 'GET');
  assert.match(mock.requests[0].url, new RegExp('sha=' + SHA));
  assert.match(mock.requests[0].url, /projectId=/u);
});

test('Free proof rejects configured URL to prevent bypass of discovery', async () => {
  const mock = resolver([deployment()]);
  await assert.rejects(
    resolveExistingStagingPreview({
      env: context({
        CANONICAL_STAGING_URL: 'https://novelrise-candidate-123.vercel.app'
      }),
      fetchImpl: mock.fetchImpl,
      resolveScope: mock.resolveScope
    }),
    /PREVIEW_DISCOVERY_READONLY/
  );
  assert.equal(mock.requests.length, 0);
});

test('Free proof rejects wrong branch, wrong repo, non-READY, Production and unrelated commit', async () => {
  const inputs = [
    deployment({ meta: { ...deployment().meta, githubCommitRef: 'main' } }),
    deployment({ meta: { ...deployment().meta, githubRepo: 'other-repo' } }),
    deployment({ meta: { ...deployment().meta, githubCommitSha: 'b'.repeat(40) } }),
    deployment({ state: 'BUILDING' }),
    deployment({ target: 'production' }),
    deployment({ url: 'novelrise.vercel.app' }),
    deployment({ projectId: 'other-project' })
  ];
  for (const invalid of inputs) {
    const mock = resolver([invalid]);
    await assert.rejects(
      resolveExistingStagingPreview({
        env: context(),
        fetchImpl: mock.fetchImpl,
        resolveScope: mock.resolveScope
      }),
      /PREVIEW_DISCOVERY_READONLY/
    );
  }
});

test('Free proof denies ambiguous deployments and incomplete pagination', async () => {
  const other = deployment({ url: 'novelrise-candidate-999.vercel.app' });
  for (const fixture of [
    resolver([deployment(), other]),
    resolver([deployment()], { next: 111 })
  ]) {
    await assert.rejects(
      resolveExistingStagingPreview({
        env: context(),
        fetchImpl: fixture.fetchImpl,
        resolveScope: fixture.resolveScope
      }),
      /PREVIEW_DISCOVERY_READONLY/
    );
  }
});
