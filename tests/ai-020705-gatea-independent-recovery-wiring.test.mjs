import assert from 'node:assert/strict';
import test from 'node:test';
import {
  create020705IndependentCensusReader,
  probe020705CensusAccess,
  validate020705CensusToken
} from '../.github/ai-02-07-05-app-composition/gatea-independent-census.mjs';
import {
  create020705IndependentRecoveryRunner,
  validate020705RecoveryEnvironment
} from '../.github/ai-02-07-05-app-composition/gatea-independent-recovery-runner.mjs';

import {
  create020705IndependentSessionRevoker,
  validate020705StopUrl
} from '../.github/ai-02-07-05-app-composition/gatea-independent-stop-ports.mjs';

const token = 'sbp_fc_fixture_only_not_a_real_token';
const env = {
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_RUN_ID: '9',
  GATEA_ACCESS_ORIGIN:
    'https://novelight-ai-gatea-controller.bingo-hooah-888.workers.dev',
  GATEA_ACCESS_CLIENT_ID: 'fixture.access',
  GATEA_ACCESS_CLIENT_SECRET: 'fixture-only'
};

test('recovery credentials are scoped to trusted main and fail closed', () => {
  assert.equal(validate020705RecoveryEnvironment(env), true);
  for (const patch of [
    { GATEA_ACCESS_CLIENT_SECRET: '' },
    { GATEA_ACCESS_CLIENT_ID: '' },
    { GATEA_ACCESS_ORIGIN: 'https://other.example' },
    { GATEA_CENSUS_READ_TOKEN: token },
    { GATEA_CENSUS_DATABASE_URL: 'fixture-only' },
    { SUPABASE_ACCESS_TOKEN: 'fixture-only' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { OPENAI_API_KEY: 'fixture-only' },
    { STAGING_DATABASE_URL: 'fixture-only' }
  ]) {
    assert.throws(
      () => validate020705RecoveryEnvironment({ ...env, ...patch }),
      /INDEPENDENT_RUNNER_NO_GO/u
    );
  }
  assert.throws(
    () => create020705IndependentRecoveryRunner({ env }),
    /INDEPENDENT_RUNNER_NO_GO/u
  );
});

test('census rejects legacy PATs and direct database credentials', () => {
  assert.equal(validate020705CensusToken(token), true);
  for (const value of ['sbp_legacy_fixture_only', 'postgresql://fixture', '']) {
    assert.throws(
      () => validate020705CensusToken(value),
      /INDEPENDENT_CENSUS_NO_GO/u
    );
  }
});

const scope = {
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 1,
  episodeId: 2,
  approvalCommentId: 3,
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_fixture'
};
const target = {
  projectRef: scope.stagingProjectRef,
  userId: scope.actorId,
  novelId: scope.novelId,
  approvalCommentId: scope.approvalCommentId
};
const row = {
  users: 0,
  identities: 0,
  sessions: 0,
  profiles: 0,
  novels: 0,
  episodes: 0,
  facts: 0,
  analysis: 0,
  reviewCandidates: 0,
  consents: 0,
  consentAudit: 0,
  usageRequests: 0,
  usageAudit: 0,
  approvalTombstoneCount: 1,
  chunkClaimsRetained: 0,
  runtimeDisabledZero: true,
  readOnlyVerified: true,
  scopeActor: scope.actorId,
  scopeNovel: '1',
  scopeEpisode: '2',
  scopeApproval: '3',
  scopeMain: scope.mainSha,
  scopePreview: scope.previewDeploymentId
};
const json = (body, status = 201) =>
  new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

test('fixed census endpoint and parameters, no raw records or auth in report', async () => {
  const reader = create020705IndependentCensusReader({
    token,
    scope,
    fetchImpl: async (url, options) => {
      assert.equal(
        url,
        'https://api.supabase.com/v1/projects/wmlzjgvxgoyrovdhbqbg/database/query/read-only'
      );
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.parameters, [
        scope.actorId,
        1,
        3,
        2,
        scope.mainSha,
        scope.previewDeploymentId
      ]);
      assert.match(body.query, /transaction_read_only/u);
      assert.match(body.query, /row_security_active/u);
      assert.match(body.query, /decrypted_secrets/u);
      return json([row]);
    }
  });
  const report = await reader(target);
  assert.equal(report.approvalTombstoneCount, 1);
  assert.equal(report.sourceKind, 'SEPARATE_STAGING_READONLY_CENSUS');
  assert.equal(Object.hasOwn(report, 'scopeActor'), false);
  await assert.rejects(reader({ ...target, novelId: 4 }), /CENSUS_NO_GO/u);
});

test('census rejects errors, filtered or writable reads and malformed results', async () => {
  for (const response of [
    json([row], 403),
    json([{ ...row, readOnlyVerified: false }]),
    json([{ ...row, scopeNovel: '9' }]),
    json([{ ...row, users: '0' }]),
    json([{ ...row, extra: 'unexpected' }]),
    json([]),
    json([row, row])
  ]) {
    const reader = create020705IndependentCensusReader({
      token,
      scope,
      fetchImpl: async () => response
    });
    await assert.rejects(reader(target), /CENSUS_NO_GO/u);
  }
  assert.equal(
    await probe020705CensusAccess({
      token,
      fetchImpl: async () => json([{ readOnlyVerified: true }])
    }),
    true
  );
});

test('STOP credentials are pinned to Staging and the dedicated role', () => {
  const url =
    'postgresql://novelight_gatea_stop:fixture@db.wmlzjgvxgoyrovdhbqbg.supabase.co:5432/postgres';
  assert.equal(validate020705StopUrl(url), true);
  for (const value of [
    url.replace('gatea_stop', 'postgres'),
    url.replace('wmlzjgvxgoyrovdhbqbg', 'other'),
    url + '?sslmode=disable'
  ]) {
    assert.throws(() => validate020705StopUrl(value), /STOP_PORT_NO_GO/u);
  }
});

test('session revoker checks synthetic identity and session readback before success', async () => {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const jwt = 'fixture'.repeat(10);
  const calls = [];
  const authAdmin = {
    async getUserById() {
      return {
        data: {
          user: {
            id: scope.actorId,
            email: 'novelight-ai-020705-fixture@example.invalid',
            app_metadata: { internal_e2e: true }
          }
        }
      };
    },
    async signOut(value, mode) {
      assert.equal(value, jwt);
      assert.equal(mode, 'global');
      calls.push('logout');
      return {};
    }
  };
  const serviceClient = {
    supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    auth: {
      admin: authAdmin,
      async getClaims() {
        return {
          data: {
            claims: {
              sub: scope.actorId,
              session_id: sessionId,
              iss: serviceClient.supabaseUrl + '/auth/v1'
            }
          }
        };
      }
    },
    async rpc(name, args) {
      assert.equal(name, 'novelight_ai_owner_session_exists_v1');
      assert.equal(args.p_actor_id, scope.actorId);
      assert.equal(args.p_session_id, sessionId);
      calls.push('session');
      return { data: !calls.includes('logout') };
    }
  };
  const revoke = create020705IndependentSessionRevoker({
    scope,
    serviceClient,
    authAdmin,
    jwt,
    sessionId
  });
  assert.equal(await revoke(scope.actorId), true);
  assert.deepEqual(calls, ['session', 'logout', 'session']);
  await assert.rejects(revoke(scope.actorId), /STOP_PORT_NO_GO/u);
});
