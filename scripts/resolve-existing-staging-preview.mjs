import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolveVercelProjectScope } from './vercel-admin-allowlist.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PRODUCTION_HOST = 'novelrise.vercel.app';

function fail(message) {
  throw new Error(`PREVIEW_DISCOVERY_READONLY: ${message}`);
}

function deploymentOrigin(deployment, expectedSha, projectId) {
  const sha = deployment?.meta?.githubCommitSha ?? deployment?.gitSource?.sha;
  const state = deployment?.readyState ?? deployment?.state;
  const target = deployment?.target;
  const gitRef = deployment?.meta?.githubCommitRef ?? deployment?.gitSource?.ref;
  const host = deployment?.url;

  if (sha !== expectedSha || state !== 'READY') return null;
  if (target && target !== 'preview') return null;
  if (gitRef === 'main') return null;
  if (deployment?.projectId && deployment.projectId !== projectId) return null;
  if (typeof host !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(host)) {
    return null;
  }
  const origin = new URL(`https://${host}`);
  if (origin.hostname === PRODUCTION_HOST) return null;
  return origin.origin;
}

export async function resolveExistingStagingPreview({
  env = process.env,
  fetchImpl = globalThis.fetch,
  resolveScope = resolveVercelProjectScope
} = {}) {
  if (String(env.CANONICAL_STAGING_URL || '').trim()) {
    return { source: 'configured', origin: env.CANONICAL_STAGING_URL.trim() };
  }
  if (env.STAGING_TRIGGER !== 'approval_comment') {
    fail('automatic discovery is restricted to an OWNER-approved Staging workflow.');
  }
  const sha = env.EXPECTED_REVISION || '';
  if (!SHA_PATTERN.test(sha)) fail('expected revision must be an exact commit SHA.');
  const token = env.VERCEL_API_TOKEN || '';
  if (!token) fail('Vercel API token is unavailable for read-only discovery.');

  const project = 'novelrise';
  const scope = await resolveScope({ fetchImpl, token, project });
  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('teamId', scope.teamId);
  url.searchParams.set('projectId', scope.projectId);
  url.searchParams.set('state', 'READY');
  url.searchParams.set('sha', sha);
  url.searchParams.set('limit', '100');

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    fail(`Vercel deployment inventory returned HTTP ${response.status}.`);
  }

  const inventory = await response.json();
  if (!Array.isArray(inventory?.deployments)) {
    fail('Vercel deployment inventory is malformed.');
  }
  if (inventory?.pagination?.next != null) {
    fail('Vercel inventory is paginated; refusing incomplete Preview discovery.');
  }

  const candidates = [
    ...new Set(
      inventory.deployments
        .map((deployment) => deploymentOrigin(deployment, sha, scope.projectId))
        .filter(Boolean)
    )
  ];
  if (candidates.length !== 1) {
    fail(
      candidates.length === 0
        ? 'no existing READY Preview matches the approved revision; no deployment was created.'
        : 'multiple matching Preview origins exist; refusing an ambiguous target.'
    );
  }

  const origin = candidates[0];
  if (env.GITHUB_ENV) {
    await appendFile(env.GITHUB_ENV, `CANONICAL_STAGING_URL=${origin}\n`);
  }
  console.log(`Discovered existing exact-revision Preview (GET-only): ${origin}`);
  return { source: 'existing-deployment', origin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resolveExistingStagingPreview().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
