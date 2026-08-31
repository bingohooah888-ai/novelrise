import { createHash } from 'node:crypto';

const ADMIN_ENV_KEY = 'NOVELIGHT_ADMIN_USER_IDS';
const MANAGED_COMMENT_PREFIX = 'NOVELIGHT managed admin allowlist ';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;

function requireNonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

export function normalizeAdminUserIds(raw) {
  const input = requireNonEmpty(raw, 'Admin user IDs');
  const ids = input.split(',').map((value) => value.trim().toLowerCase());

  if (ids.some((value) => !UUID_PATTERN.test(value))) {
    throw new Error('Admin user IDs must contain only valid UUIDs.');
  }

  if (new Set(ids).size !== ids.length) {
    throw new Error('Admin user IDs must not contain duplicates.');
  }

  return [...ids].sort().join(',');
}

export function fingerprintAdminUserIds(raw) {
  const canonical = normalizeAdminUserIds(raw);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function envTargetsProduction(env) {
  return Array.isArray(env?.target) && env.target.includes('production');
}

export function selectProductionAdminEnv(payload) {
  const envs = Array.isArray(payload) ? payload : payload?.envs;
  if (!Array.isArray(envs)) {
    throw new Error('Vercel environment response is malformed.');
  }

  const matches = envs.filter(
    (env) => env?.key === ADMIN_ENV_KEY && envTargetsProduction(env)
  );

  if (matches.length > 1) {
    throw new Error('Multiple Production admin allowlist variables exist.');
  }

  return matches[0] ?? null;
}

function managedComment(fingerprint) {
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error('Admin allowlist fingerprint is invalid.');
  }
  return `${MANAGED_COMMENT_PREFIX}${fingerprint}`;
}

function buildApiUrl(path, extra = {}) {
  const url = new URL(path, 'https://api.vercel.com');
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function buildUrl(path, teamId, extra = {}) {
  return buildApiUrl(path, {
    teamId: requireNonEmpty(teamId, 'Vercel team ID'),
    ...extra
  });
}

async function vercelRequest(
  fetchImpl,
  { token, url, method = 'GET', body, allowNotFound = false }
) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${requireNonEmpty(token, 'Vercel API token')}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (allowNotFound && response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Vercel API request failed safely with HTTP ${response.status}.`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function resolveVercelProjectScope({
  fetchImpl = fetch,
  token,
  project = 'novelrise'
}) {
  const projectName = requireNonEmpty(project, 'Vercel project name');
  const teamsPayload = await vercelRequest(fetchImpl, {
    token,
    url: buildApiUrl('/v2/teams', { limit: 100 })
  });

  if (!Array.isArray(teamsPayload?.teams)) {
    throw new Error('Vercel teams response is malformed.');
  }
  if (teamsPayload?.pagination?.next != null) {
    throw new Error('Vercel team discovery is paginated; refusing incomplete scope resolution.');
  }

  const matches = [];
  for (const team of teamsPayload.teams) {
    const teamId = requireNonEmpty(team?.id, 'Vercel team ID');
    const projectPayload = await vercelRequest(fetchImpl, {
      token,
      url: buildUrl(`/v9/projects/${encodeURIComponent(projectName)}`, teamId),
      allowNotFound: true
    });

    if (!projectPayload) continue;

    if (projectPayload.name !== projectName) {
      throw new Error('Vercel project response does not match the expected project name.');
    }
    if (projectPayload.accountId !== teamId) {
      throw new Error('Vercel project ownership metadata does not match the resolved team.');
    }
    const projectId = requireNonEmpty(projectPayload.id, 'Vercel project ID');
    matches.push({ teamId, projectId, project: projectName });
  }

  if (matches.length === 0) {
    throw new Error('Expected Vercel project was not found in any token-accessible team.');
  }
  if (matches.length > 1) {
    throw new Error('Multiple Vercel teams expose the expected project; scope is ambiguous.');
  }

  return matches[0];
}

export async function inspectVercelAdminAllowlist({
  fetchImpl = fetch,
  token,
  teamId,
  project = 'novelrise',
  adminUserIds
}) {
  const canonical = normalizeAdminUserIds(adminUserIds);
  const fingerprint = fingerprintAdminUserIds(canonical);
  const url = buildUrl(`/v9/projects/${encodeURIComponent(project)}/env`, teamId);
  const payload = await vercelRequest(fetchImpl, { token, url });
  const env = selectProductionAdminEnv(payload);

  if (!env) {
    return { verdict: 'refresh-required', reason: 'missing', fingerprint };
  }

  if (env.type !== 'sensitive') {
    return {
      verdict: 'unknown',
      reason: 'existing-variable-is-not-sensitive',
      fingerprint,
      envId: env.id ?? null
    };
  }

  const expectedComment = managedComment(fingerprint);
  if (env.comment === expectedComment) {
    return {
      verdict: 'current',
      reason: 'managed-fingerprint-matches',
      fingerprint,
      envId: env.id ?? null,
      updatedAt: env.updatedAt ?? null
    };
  }

  return {
    verdict: 'refresh-required',
    reason: 'managed-fingerprint-differs',
    fingerprint,
    envId: env.id ?? null,
    updatedAt: env.updatedAt ?? null
  };
}

export async function syncVercelAdminAllowlist({
  fetchImpl = fetch,
  token,
  teamId,
  project = 'novelrise',
  adminUserIds,
  expectedFingerprint
}) {
  const canonical = normalizeAdminUserIds(adminUserIds);
  const fingerprint = fingerprintAdminUserIds(canonical);

  if (fingerprint !== expectedFingerprint) {
    throw new Error('Admin allowlist changed after approval request creation.');
  }

  const inspection = await inspectVercelAdminAllowlist({
    fetchImpl,
    token,
    teamId,
    project,
    adminUserIds: canonical
  });

  if (inspection.verdict === 'current') {
    return { ...inspection, action: 'none' };
  }
  if (inspection.verdict !== 'refresh-required') {
    throw new Error('Admin allowlist state is unknown; refusing Production mutation.');
  }

  const comment = managedComment(fingerprint);
  if (!inspection.envId) {
    const url = buildUrl(`/v10/projects/${encodeURIComponent(project)}/env`, teamId);
    await vercelRequest(fetchImpl, {
      token,
      url,
      method: 'POST',
      body: [
        {
          key: ADMIN_ENV_KEY,
          value: canonical,
          type: 'sensitive',
          target: ['production'],
          comment
        }
      ]
    });
    return { verdict: 'refresh-required', fingerprint, action: 'created' };
  }

  const url = buildUrl(
    `/v9/projects/${encodeURIComponent(project)}/env/${encodeURIComponent(inspection.envId)}`,
    teamId
  );
  await vercelRequest(fetchImpl, {
    token,
    url,
    method: 'PATCH',
    body: { value: canonical, comment }
  });
  return { verdict: 'refresh-required', fingerprint, action: 'updated' };
}

export async function createProductionDeployment({
  fetchImpl = fetch,
  token,
  teamId,
  project = 'novelrise',
  repoId,
  mainSha
}) {
  const sha = requireNonEmpty(mainSha, 'Approved main SHA');
  if (!SHA_PATTERN.test(sha)) {
    throw new Error('Approved main SHA is invalid.');
  }
  const numericRepoId = Number(repoId);
  if (!Number.isSafeInteger(numericRepoId) || numericRepoId <= 0) {
    throw new Error('GitHub repository ID is invalid.');
  }

  const url = buildUrl('/v13/deployments', teamId, { forceNew: 1 });
  const payload = await vercelRequest(fetchImpl, {
    token,
    url,
    method: 'POST',
    body: {
      name: project,
      target: 'production',
      gitSource: {
        type: 'github',
        ref: 'main',
        repoId: numericRepoId,
        sha
      }
    }
  });

  if (!payload?.id) {
    throw new Error('Vercel did not return a deployment ID.');
  }
  return { deploymentId: payload.id };
}

export async function waitForDeploymentReady({
  fetchImpl = fetch,
  token,
  teamId,
  deploymentId,
  maxAttempts = 72,
  delayMs = 5000
}) {
  const id = requireNonEmpty(deploymentId, 'Deployment ID');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = buildUrl(`/v13/deployments/${encodeURIComponent(id)}`, teamId);
    const payload = await vercelRequest(fetchImpl, { token, url });
    const state = payload?.readyState;

    if (state === 'READY') {
      return { deploymentId: id, readyState: state, url: payload.url ?? null };
    }
    if (state === 'ERROR' || state === 'CANCELED') {
      throw new Error(`Vercel Production deployment ended in ${state}.`);
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Vercel Production deployment did not reach READY within the bounded wait.');
}

export async function waitForProductionRevision({
  fetchImpl = fetch,
  productionOrigin = 'https://novelrise.vercel.app',
  expectedSha,
  maxAttempts = 36,
  delayMs = 5000
}) {
  if (!SHA_PATTERN.test(expectedSha)) {
    throw new Error('Expected Production SHA is invalid.');
  }

  const url = new URL('/api/deployment-revision', productionOrigin);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.commitSha === expectedSha) {
        return { commitSha: expectedSha };
      }
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Production revision did not converge to the approved main SHA.');
}

export async function verifyAdminEndpointRequiresAuthentication({
  fetchImpl = fetch,
  productionOrigin = 'https://novelrise.vercel.app'
}) {
  const response = await fetchImpl(new URL('/api/admin-dashboard', productionOrigin), {
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (response.status !== 401) {
    throw new Error('Admin endpoint did not enforce the expected unauthenticated boundary.');
  }
  return { protected: true };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function resolveCommandTeamId(common) {
  const scope = await resolveVercelProjectScope({
    token: common.token,
    project: common.project
  });
  return scope.teamId;
}

async function main() {
  const command = process.argv[2];
  const common = {
    token: process.env.VERCEL_API_TOKEN,
    project: process.env.VERCEL_PROJECT_NAME || 'novelrise',
    adminUserIds: process.env.NOVELIGHT_PRODUCTION_ADMIN_USER_IDS
  };

  if (command === 'fingerprint') {
    printJson({ fingerprint: fingerprintAdminUserIds(common.adminUserIds) });
    return;
  }

  if (command === 'inspect') {
    const teamId = await resolveCommandTeamId(common);
    printJson(await inspectVercelAdminAllowlist({ ...common, teamId }));
    return;
  }

  if (command === 'sync') {
    const teamId = await resolveCommandTeamId(common);
    printJson(
      await syncVercelAdminAllowlist({
        ...common,
        teamId,
        expectedFingerprint: process.env.APPROVED_ADMIN_ALLOWLIST_FINGERPRINT
      })
    );
    return;
  }

  if (command === 'deploy') {
    const teamId = await resolveCommandTeamId(common);
    printJson(
      await createProductionDeployment({
        token: common.token,
        teamId,
        project: common.project,
        repoId: process.env.GITHUB_REPOSITORY_ID,
        mainSha: process.env.APPROVED_MAIN_SHA
      })
    );
    return;
  }

  if (command === 'wait-deployment') {
    const teamId = await resolveCommandTeamId(common);
    printJson(
      await waitForDeploymentReady({
        token: common.token,
        teamId,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID
      })
    );
    return;
  }

  if (command === 'verify-production') {
    await waitForProductionRevision({
      productionOrigin: process.env.NOVELIGHT_PRODUCTION_ORIGIN,
      expectedSha: process.env.APPROVED_MAIN_SHA
    });
    await verifyAdminEndpointRequiresAuthentication({
      productionOrigin: process.env.NOVELIGHT_PRODUCTION_ORIGIN
    });
    printJson({ ok: true, protected: true, commitSha: process.env.APPROVED_MAIN_SHA });
    return;
  }

  throw new Error('Unknown Vercel admin allowlist command.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Safety stop: ${error.message}`);
    process.exitCode = 1;
  });
}
