import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { create020705UnpaidMigrationInspector } from '../.github/ai-02-07-05-app-composition/staging-live-migrations.mjs';
// prettier-ignore
import { create020705UnpaidPreviewInspector } from '../.github/ai-02-07-05-app-composition/staging-live-preview.mjs';
// prettier-ignore
import { create020705UnpaidJwtAdapter } from '../.github/ai-02-07-05-app-composition/staging-live-jwt.mjs';
// prettier-ignore
import { create020705UnpaidStagingBindings } from '../.github/ai-02-07-05-app-composition/staging-unpaid-bindings.mjs';

const ref = 'wmlzjgvxgoyrovdhbqbg';
const url = 'https://' + ref + '.supabase.co';
const db = 'postgresql://postgres:fixture@db.' + ref + '.supabase.co:5432/postgres';
// prettier-ignore
const scope = {
  repository: 'bingohooah888-ai/novelrise', prNumber: 2895,
  stagingProjectRef: ref, supabaseUrl: url, mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40), stagingBranch: 'staging/ai-02-07-05-offline-proof',
  previewDeploymentId: 'dpl_fixture', actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 998892071, episodeId: 998892072, consentRevision: 'synthetic-proof',
  maxPaidCalls: 0, capMicros: 0, maxPreviews: 0, maxMigrations: 0,
  existingMigrationsOnly: true, existingPreviewOnly: true
};

// prettier-ignore
test('unpaid migration exposes inspection only and queries no writes', async () => {
  const queries = [];
  const migration = create020705UnpaidMigrationInspector({
    scope, connectionString: db, githubToken: 'fixture-token',
    fetchImpl: () => { throw new Error('unexpected fetch'); },
    mainMigrationFiles: () => [],
    clientFactory: () => ({
      async connect() {},
      async query(sql) {
        queries.push(sql);
        if (queries.length === 1) return { rows: [{ database_name: 'postgres', db_role: 'postgres' }] };
        if (queries.length === 2) return { rows: [{ version: '20261116220100' }, { version: '20261116220101' }] };
        return { rows: [{ review_table: true, review_rpc: true, session_rpc: true, claim_table: true, claim_rpc: true }] };
      },
      async end() {}
    })
  });
  assert.deepEqual(Object.keys(migration), ['inspectInstalled']);
  assert.equal(await migration.inspectInstalled(), true);
  assert.equal(queries.length, 3);
  assert.ok(queries.every((q) => q.startsWith('select ')));
});

// prettier-ignore
test('unpaid Preview checks existing exact ID and never creates deployment', async () => {
  const requests = [];
  const keys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
    'NOVELIGHT_STAGING_SUPABASE_URL', 'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
    'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED', 'NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED',
    'NOVELIGHT_AI_020705_STAGING_PREVIEW_ENABLED', 'NOVELIGHT_AI_020705_ONE_SHOT_ENABLED'];
  const reply = (status, body) => ({ status, json: async () => body });
  const options = {
    scope, token: 'fixture-token-12345678', projectId: 'prj_fixture',
    existingDeploymentId: scope.previewDeploymentId,
    protectionBypass: 'fixture-bypass-123456', sleep: async () => {},
    async fetchImpl(uri, init) {
      requests.push({ uri, method: init.method ?? 'GET' });
      if (uri.includes('/env?')) return reply(200, { envs: keys.map((key) => ({
        key, gitBranch: scope.stagingBranch, target: ['preview']
      })) });
      if (uri.includes('/v9/projects/')) return reply(200, {
        id: 'prj_fixture', name: 'novelrise', link: { type: 'github', repoId: 42, repo: 'novelrise' }
      });
      if (uri.includes('/v13/deployments/')) return reply(200, {
        id: scope.previewDeploymentId, readyState: 'READY', projectId: 'prj_fixture',
        target: null, gitSource: { sha: scope.candidateSha, ref: scope.stagingBranch },
        url: 'fixture.vercel.app'
      });
      return init.headers ? reply(200, { commitSha: scope.candidateSha, supabaseUrl: url, target: 'preview' }) : reply(401, {});
    }
  };
  assert.throws(() => create020705UnpaidPreviewInspector({ ...options, existingDeploymentId: null }));
  assert.equal(requests.length, 0);
  const result = await create020705UnpaidPreviewInspector(options).preparePreview();
  assert.equal(result.id, scope.previewDeploymentId);
  assert.ok(requests.every((r) => r.method === 'GET'));
  assert.ok(requests.some((r) => r.uri.includes('decrypt=false')));
});

// prettier-ignore
test('unpaid JWT constructor exposes no paid synthetic getter', () => {
  const noop = () => { throw new Error('unexpected I/O'); };
  const auth = { admin: { createUser: noop, getUserById: noop, deleteUser: noop },
    getClaims: noop, signInWithPassword: noop, signOut: noop };
  const client = { auth, rpc: noop, from: noop };
  const adapter = create020705UnpaidJwtAdapter({
    scope, connectionString: db, secretKey: 'fixture-secret-12345678',
    publishableKey: 'sb_publishable_fixture', serviceClient: client,
    authorClient: client, outsiderClient: client, dbFactory: noop
  });
  assert.equal(Object.hasOwn(adapter, 'synthetic'), false);
  assert.throws(() => create020705UnpaidJwtAdapter({
    scope: { ...scope, maxPaidCalls: 1 }, connectionString: db,
    secretKey: 'fixture-secret-12345678', publishableKey: 'sb_publishable_fixture',
    serviceClient: client, authorClient: client, outsiderClient: client, dbFactory: noop
  }));
});

// prettier-ignore
test('unpaid live binding cannot construct clients while Gate A is NO-GO', async () => {
  let called = 0;
  const denyIO = () => { called += 1; throw new Error('unexpected I/O'); };
  const options = {
    scope, credentials: {}, fetchImpl: denyIO,
    authority: { verifyOwnerAndRefs: async () => true, verifyIndependentGateA: async () => false,
      verifyStagingIsolation: denyIO, consumeUnpaidApprovalOnce: denyIO },
    controller: { disableTrialEnvironment: denyIO, revokeSyntheticSessions: denyIO,
      independentCensus: denyIO }
  };
  await assert.rejects(create020705UnpaidStagingBindings(options).run(), /AI_020705_UNPAID_BINDINGS_NO_GO/u);
  assert.throws(() => create020705UnpaidStagingBindings({
    ...options, credentials: { openAiApiKey: 'fixture' }
  }), /AI_020705_UNPAID_BINDINGS_NO_GO/u);
  assert.equal(called, 0);
});
