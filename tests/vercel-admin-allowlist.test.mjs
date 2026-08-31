import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createProductionDeployment,
  fingerprintAdminUserIds,
  inspectVercelAdminAllowlist,
  normalizeAdminUserIds,
  selectProductionAdminEnv,
  syncVercelAdminAllowlist,
  verifyAdminEndpointRequiresAuthentication
} from '../scripts/vercel-admin-allowlist.mjs';

const workflowPath = new globalThis.URL(
  '../.github/workflows/vercel-admin-allowlist.yml',
  import.meta.url
);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

const adminIdA = '11111111-1111-4111-8111-111111111111';
const adminIdB = '22222222-2222-4222-8222-222222222222';

test('admin user IDs are canonicalized and fingerprinted without retaining input order', () => {
  assert.equal(
    normalizeAdminUserIds(` ${adminIdB.toUpperCase()}, ${adminIdA} `),
    `${adminIdA},${adminIdB}`
  );
  assert.match(
    fingerprintAdminUserIds(`${adminIdB},${adminIdA}`),
    /^sha256:[0-9a-f]{64}$/
  );
  assert.equal(
    fingerprintAdminUserIds(`${adminIdB},${adminIdA}`),
    fingerprintAdminUserIds(`${adminIdA},${adminIdB}`)
  );
});

test('admin user IDs fail closed on invalid or duplicate UUIDs', () => {
  assert.throws(() => normalizeAdminUserIds('not-a-uuid'), /valid UUIDs/);
  assert.throws(
    () => normalizeAdminUserIds(`${adminIdA},${adminIdA}`),
    /duplicates/
  );
});

test('Production admin environment selection rejects ambiguous state', () => {
  assert.equal(
    selectProductionAdminEnv({
      envs: [
        { id: 'preview', key: 'NOVELIGHT_ADMIN_USER_IDS', target: ['preview'] },
        { id: 'prod', key: 'NOVELIGHT_ADMIN_USER_IDS', target: ['production'] }
      ]
    }).id,
    'prod'
  );

  assert.throws(
    () =>
      selectProductionAdminEnv({
        envs: [
          { id: 'a', key: 'NOVELIGHT_ADMIN_USER_IDS', target: ['production'] },
          { id: 'b', key: 'NOVELIGHT_ADMIN_USER_IDS', target: ['production'] }
        ]
      }),
    /Multiple Production/
  );
});

test('inspection treats only a matching sensitive managed variable as current', async () => {
  const fingerprint = fingerprintAdminUserIds(adminIdA);
  const fetchImpl = async () =>
    jsonResponse({
      envs: [
        {
          id: 'env_1',
          key: 'NOVELIGHT_ADMIN_USER_IDS',
          type: 'sensitive',
          target: ['production'],
          comment: `NOVELIGHT managed admin allowlist ${fingerprint}`,
          updatedAt: 123456789
        }
      ]
    });

  const result = await inspectVercelAdminAllowlist({
    fetchImpl,
    token: 'token-for-test',
    teamId: 'team_for_test',
    adminUserIds: adminIdA
  });

  assert.equal(result.verdict, 'current');
  assert.equal(result.envId, 'env_1');
  assert.equal(result.updatedAt, 123456789);
});

test('non-sensitive existing allowlist is unknown and cannot be overwritten', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      envs: [
        {
          id: 'env_plain',
          key: 'NOVELIGHT_ADMIN_USER_IDS',
          type: 'encrypted',
          target: ['production']
        }
      ]
    });

  const inspection = await inspectVercelAdminAllowlist({
    fetchImpl,
    token: 'token-for-test',
    teamId: 'team_for_test',
    adminUserIds: adminIdA
  });
  assert.equal(inspection.verdict, 'unknown');

  await assert.rejects(
    syncVercelAdminAllowlist({
      fetchImpl,
      token: 'token-for-test',
      teamId: 'team_for_test',
      adminUserIds: adminIdA,
      expectedFingerprint: fingerprintAdminUserIds(adminIdA)
    }),
    /state is unknown/
  );
});

test('missing allowlist is created as sensitive Production-only data', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if ((options?.method ?? 'GET') === 'GET') {
      return jsonResponse({ envs: [] });
    }
    return jsonResponse([{ id: 'env_created' }]);
  };
  const fingerprint = fingerprintAdminUserIds(adminIdA);

  const result = await syncVercelAdminAllowlist({
    fetchImpl,
    token: 'token-for-test',
    teamId: 'team_for_test',
    adminUserIds: adminIdA,
    expectedFingerprint: fingerprint
  });

  assert.equal(result.action, 'created');
  const createCall = calls.find((call) => call.options.method === 'POST');
  const body = JSON.parse(createCall.options.body);
  assert.deepEqual(body[0].target, ['production']);
  assert.equal(body[0].type, 'sensitive');
  assert.equal(body[0].key, 'NOVELIGHT_ADMIN_USER_IDS');
  assert.equal(body[0].value, adminIdA);
  assert.equal(
    body[0].comment,
    `NOVELIGHT managed admin allowlist ${fingerprint}`
  );
});

test('Production redeploy is pinned to the approved GitHub SHA', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ id: 'dpl_123' });
  };
  const mainSha = 'a'.repeat(40);

  const result = await createProductionDeployment({
    fetchImpl,
    token: 'token-for-test',
    teamId: 'team_for_test',
    project: 'novelrise',
    repoId: 1335499017,
    mainSha
  });

  assert.equal(result.deploymentId, 'dpl_123');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.target, 'production');
  assert.equal(payload.gitSource.type, 'github');
  assert.equal(payload.gitSource.ref, 'main');
  assert.equal(payload.gitSource.repoId, 1335499017);
  assert.equal(payload.gitSource.sha, mainSha);
  assert.match(calls[0].url, /forceNew=1/);
});

test('admin endpoint verification requires an unauthenticated 401', async () => {
  await assert.doesNotReject(
    verifyAdminEndpointRequiresAuthentication({
      fetchImpl: async () => jsonResponse({}, 401)
    })
  );
  await assert.rejects(
    verifyAdminEndpointRequiresAuthentication({
      fetchImpl: async () => jsonResponse({}, 200)
    }),
    /unauthenticated boundary/
  );
});

test('workflow keeps raw admin IDs and Vercel token in secrets and requires OWNER approval', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.match(workflow, /secrets\.VERCEL_API_TOKEN/);
  assert.match(workflow, /secrets\.VERCEL_TEAM_ID/);
  assert.match(workflow, /secrets\.NOVELIGHT_PRODUCTION_ADMIN_USER_IDS/);
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_VERCEL_ADMIN_ALLOWLIST_APPROVE/);
  assert.match(
    workflow,
    /main changed after this Production action was approved/
  );
  assert.match(workflow, /NOVELIGHT_VERCEL_ADMIN_ALLOWLIST_CLAIMED/);
  assert.match(workflow, /NOVELIGHT_VERCEL_ADMIN_ALLOWLIST_CONSUMED/);
  assert.match(workflow, /environment: Production/);
  assert.doesNotMatch(workflow, /11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(workflow, /sb_secret_|service_role/);
});
