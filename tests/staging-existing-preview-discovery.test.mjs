import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveExistingStagingPreview } from '../scripts/resolve-existing-staging-preview.mjs';

const SHA = '1234567890abcdef1234567890abcdef12345678';
const PREVIEW = 'novelrise-unique-xyz.vercel.app';
const env = {
  STAGING_TRIGGER: 'approval_comment',
  EXPECTED_REVISION: SHA,
  VERCEL_API_TOKEN: 'test-only-token'
};
const scope = async () => ({ teamId: 'team_test', projectId: 'prj_test' });
const candidate = (overrides = {}) => ({
  meta: { githubCommitSha: SHA, githubCommitRef: 'staging-thumbnail-smoke' },
  readyState: 'READY',
  target: 'preview',
  projectId: 'prj_test',
  url: PREVIEW,
  ...overrides
});

function inventory(deployments, pagination = { next: null }) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method });
      return new globalThis.Response(
        JSON.stringify({ deployments, pagination }),
        {
          status: 200
        }
      );
    }
  };
}

test('configured canonical URL skips discovery', async () => {
  const result = await resolveExistingStagingPreview({
    env: { CANONICAL_STAGING_URL: 'https://existing.vercel.app' },
    fetchImpl: () => {
      throw new Error('no network request expected');
    },
    resolveScope: () => {
      throw new Error('no scope lookup expected');
    }
  });
  assert.equal(result.source, 'configured');
});

test('reuses one exact-SHA Preview with a read-only GET', async () => {
  const fixture = inventory([candidate(), candidate({ target: 'production' })]);
  const dir = await mkdtemp(join(tmpdir(), 'novelight-preview-discovery-'));
  const githubEnv = join(dir, 'environment');
  const result = await resolveExistingStagingPreview({
    env: { ...env, GITHUB_ENV: githubEnv },
    resolveScope: scope,
    fetchImpl: fixture.fetchImpl
  });
  assert.deepEqual(result, {
    source: 'existing-deployment',
    origin: `https://${PREVIEW}`
  });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].method, 'GET');
  const url = new globalThis.URL(fixture.calls[0].url);
  assert.equal(url.searchParams.get('sha'), SHA);
  assert.equal(url.searchParams.get('teamId'), 'team_test');
  assert.equal(url.searchParams.get('projectId'), 'prj_test');
  assert.match(
    await readFile(githubEnv, 'utf8'),
    /CANONICAL_STAGING_URL=https:\/\/novelrise-unique-xyz\.vercel\.app/
  );
});

test('missing Preview does not trigger a deployment', async () => {
  const fixture = inventory([
    candidate({ meta: { githubCommitSha: 'wrong' } })
  ]);
  await assert.rejects(
    resolveExistingStagingPreview({
      env,
      resolveScope: scope,
      fetchImpl: fixture.fetchImpl
    }),
    /no existing READY Preview/
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.method),
    ['GET']
  );
});

test('rejects Production and ambiguous Preview origins', async () => {
  const rejected = inventory([
    candidate({ meta: { githubCommitSha: SHA, githubCommitRef: 'main' } }),
    candidate({ url: 'novelrise.vercel.app' })
  ]);
  await assert.rejects(
    resolveExistingStagingPreview({
      env,
      resolveScope: scope,
      fetchImpl: rejected.fetchImpl
    }),
    /no existing READY Preview/
  );

  const ambiguous = inventory([
    candidate(),
    candidate({ url: 'second-preview.vercel.app' })
  ]);
  await assert.rejects(
    resolveExistingStagingPreview({
      env,
      resolveScope: scope,
      fetchImpl: ambiguous.fetchImpl
    }),
    /multiple matching Preview origins/
  );
});

test('rejects pagination and unapproved triggers', async () => {
  const paginated = inventory([candidate()], { next: 42 });
  await assert.rejects(
    resolveExistingStagingPreview({
      env,
      resolveScope: scope,
      fetchImpl: paginated.fetchImpl
    }),
    /paginated/
  );
  await assert.rejects(
    resolveExistingStagingPreview({
      env: { ...env, STAGING_TRIGGER: 'deployment_status' },
      fetchImpl: () => {
        throw new Error('should not fetch');
      }
    }),
    /OWNER-approved Staging workflow/
  );
});
