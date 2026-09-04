import { appendFile } from 'node:fs/promises';
import { resolveVercelProjectScope } from './vercel-admin-allowlist.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const PRODUCTION_HOST = 'novelrise.vercel.app';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

async function vercelRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${required(token, 'Vercel API token')}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new Error(
      `Vercel API request failed safely with HTTP ${response.status}.`
    );
  }
  return response.json();
}

function teamUrl(path, teamId, extra = {}) {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', required(teamId, 'Vercel team ID'));
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function assertPreviewPayload(payload, expectedSha, expectedRef) {
  if (payload?.readyState !== 'READY') {
    throw new Error(
      `Vercel Preview did not reach READY; observed ${payload?.readyState || 'unknown'}.`
    );
  }

  const deploymentTarget = payload?.target ?? null;
  if (deploymentTarget && deploymentTarget !== 'preview') {
    throw new Error(
      `Vercel deployment target is not Preview; observed ${deploymentTarget}.`
    );
  }

  const deploymentUrl = required(payload?.url, 'Vercel Preview URL');
  const origin = new URL(`https://${deploymentUrl}`);
  if (
    !origin.hostname.endsWith('.vercel.app') ||
    origin.hostname === PRODUCTION_HOST
  ) {
    throw new Error(
      'Vercel Preview URL is not an allowed non-Production vercel.app host.'
    );
  }

  const observedSha =
    payload?.meta?.githubCommitSha ?? payload?.gitSource?.sha ?? null;
  if (observedSha !== expectedSha) {
    throw new Error('Vercel Preview commit SHA does not match exact current main.');
  }

  const observedRef =
    payload?.meta?.githubCommitRef ?? payload?.gitSource?.ref ?? null;
  if (observedRef && observedRef !== expectedRef) {
    throw new Error(
      'Vercel Preview Git ref does not match the dedicated staging ref.'
    );
  }

  if (!deploymentTarget) {
    console.log(
      'Vercel deployment target field is absent; runtime VERCEL_ENV=preview verification remains mandatory.'
    );
  }

  return origin.origin;
}

async function createExactPreview({ token, teamId, project, repoId, sha, ref }) {
  const createUrl = teamUrl('/v13/deployments', teamId, { forceNew: 1 });
  const created = await vercelRequest(createUrl, token, {
    method: 'POST',
    body: JSON.stringify({
      name: project,
      gitSource: {
        type: 'github',
        repoId,
        ref,
        sha
      }
    })
  });
  const deploymentId = required(created?.id, 'Vercel deployment ID');

  for (let attempt = 1; attempt <= 72; attempt += 1) {
    const payload = await vercelRequest(
      teamUrl(`/v13/deployments/${encodeURIComponent(deploymentId)}`, teamId),
      token
    );
    if (payload?.readyState === 'READY') {
      return assertPreviewPayload(payload, sha, ref);
    }
    if (['ERROR', 'CANCELED'].includes(payload?.readyState)) {
      throw new Error(`Vercel Preview ended in ${payload.readyState}.`);
    }
    if (attempt < 72) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 5000));
    }
  }
  throw new Error(
    'Vercel Preview did not reach READY within the bounded wait.'
  );
}

async function main() {
  const token = required(process.env.VERCEL_API_TOKEN, 'VERCEL_API_TOKEN');
  const project = required(
    process.env.VERCEL_PROJECT_NAME || 'novelrise',
    'VERCEL_PROJECT_NAME'
  );
  const sha = required(process.env.EXPECTED_REVISION, 'EXPECTED_REVISION');
  const ref = required(process.env.STAGING_PREVIEW_REF, 'STAGING_PREVIEW_REF');
  const repoId = Number(process.env.GITHUB_REPOSITORY_ID);

  if (!SHA_PATTERN.test(sha)) {
    throw new Error('EXPECTED_REVISION must be an exact 40-character SHA.');
  }
  if (!REF_PATTERN.test(ref) || ref.includes('..')) {
    throw new Error('STAGING_PREVIEW_REF is invalid.');
  }
  if (!Number.isSafeInteger(repoId) || repoId <= 0) {
    throw new Error('GITHUB_REPOSITORY_ID is invalid.');
  }

  const scope = await resolveVercelProjectScope({ token, project });
  const origin = await createExactPreview({
    token,
    teamId: scope.teamId,
    project,
    repoId,
    sha,
    ref
  });

  if (!process.env.GITHUB_ENV) {
    throw new Error('GITHUB_ENV is unavailable.');
  }
  await appendFile(
    process.env.GITHUB_ENV,
    `CANONICAL_STAGING_URL=${origin}\n`
  );
  console.log(`Validated dedicated Vercel Preview target: ${origin}`);
}

main().catch((error) => {
  console.error(`Safety stop: ${error.message}`);
  process.exitCode = 1;
});
