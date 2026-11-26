import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import test from 'node:test';
import worker, {
  GateAWatchdogDurableObject,
  inspect020705CloudflareGithubExit,
  verify020705CloudflareSignature
} from '../.github/staging-ai-02-07-05/cloudflare-gatea-live-candidate.mjs';
import { create020705TrustedMainRuntime } from '../.github/ai-02-07-05-app-composition/trusted-main-live-runtime.mjs';

const sha = 'a'.repeat(40);
const scope = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: sha,
  previewDeploymentId: 'dpl_HscqVwRoSCxBAt9C3LHLof5971L9',
  actorId: '12345678-1234-4234-8234-123456789abc',
  novelId: 1,
  episodeId: 2,
  runId: 3,
  approvalCommentId: 4
};

test('candidate rejects public traffic and stays disabled', async () => {
  const runtime = new GateAWatchdogDurableObject({}, {});
  assert.equal((await runtime.fetch()).status, 404);
  assert.equal((await worker.fetch({ method: 'POST' }, {})).status, 404);
  await assert.rejects(runtime.arm(), /CLOUDFLARE_LIVE_NO_GO/);
  await assert.rejects(runtime.heartbeat(), /CLOUDFLARE_LIVE_NO_GO/);
  assert.equal(await runtime.alarm(), undefined); // OFF alarms are inert
});

test('owner grant requires a pinned Ed25519 signature', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const domain = 'NOVELIGHT_AI_020705_OWNER_ARM_V1';
  const payload = {
    scope,
    nonce: 'x'.repeat(40),
    controllerRunId: 9,
    expiresAtMs: 1234
  };
  const signature = sign(
    null,
    Buffer.from(JSON.stringify([domain, payload])),
    privateKey
  ).toString('base64url');
  const pinnedSpkiBase64 = publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  assert.equal(
    await verify020705CloudflareSignature({
      domain,
      payload,
      signature,
      pinnedSpkiBase64,
      cryptoImpl: webcrypto
    }),
    true
  );
  assert.equal(
    await verify020705CloudflareSignature({
      domain,
      payload: { ...payload, controllerRunId: 10 },
      signature,
      pinnedSpkiBase64,
      cryptoImpl: webcrypto
    }),
    false
  );
});

test('independent GitHub proof requires a terminal owner run', async () => {
  const run = {
    id: 3,
    head_sha: sha,
    head_branch: 'main',
    path: '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
    repository: { full_name: 'bingohooah888-ai/novelrise' },
    actor: { login: 'bingohooah888-ai' },
    triggering_actor: { login: 'bingohooah888-ai' },
    event: 'workflow_dispatch',
    run_attempt: 1,
    status: 'completed',
    conclusion: 'cancelled'
  };
  const jobs = {
    total_count: 1,
    jobs: [{ run_id: 3, status: 'completed' }]
  };
  const response = (value) => ({
    ok: true,
    status: 200,
    json: async () => value
  });
  const reader = (candidate) => async (url) =>
    response(url.includes('?per_page=100') ? jobs : candidate);
  const args = {
    scope,
    readToken: 'a'.repeat(32),
    fetchImpl: reader(run)
  };
  assert.equal(
    (await inspect020705CloudflareGithubExit(args))
      .independentGithubExitVerified,
    true
  );
  for (const patch of [
    { status: 'in_progress' },
    { head_branch: 'production' },
    { actor: { login: 'other' } }
  ]) {
    await assert.rejects(
      inspect020705CloudflareGithubExit({
        ...args,
        fetchImpl: reader({ ...run, ...patch })
      }),
      /CLOUDFLARE_LIVE_NO_GO/
    );
  }
});

test('trusted main and detached recovery reject missing capabilities', () => {
  assert.throws(
    () => create020705TrustedMainRuntime(),
    /TRUSTED_RUNTIME_WIRING_DENIED/
  );
});

test('expired heartbeat can yield a fresh signed death after GitHub exit', async (t) => {
  const heartbeat = 1800000000000;
  let clock = heartbeat + 16000;
  t.mock.method(Date, 'now', () => clock);
  const { privateKey } = generateKeyPairSync('ed25519');
  const fields = Object.keys(scope);
  const row = {
    scope: JSON.stringify(fields.map((key) => scope[key])),
    nonce: 'x'.repeat(40),
    controller_run_id: 9,
    heartbeat_ms: heartbeat,
    deadline_ms: heartbeat + 15000,
    state: 'WATCHING'
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    clock += 200;
    return {
      ok: true,
      status: 200,
      json: async () =>
        url.includes('/jobs?')
          ? { total_count: 1, jobs: [{ run_id: 3, status: 'completed' }] }
          : {
              id: 3,
              head_sha: sha,
              head_branch: 'main',
              path: '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
              repository: { full_name: scope.repository },
              actor: { login: 'bingohooah888-ai' },
              triggering_actor: { login: 'bingohooah888-ai' },
              event: 'workflow_dispatch',
              run_attempt: 1,
              status: 'completed',
              conclusion: 'cancelled'
            }
    };
  });
  let dispatched;
  const storage = {
    transactionSync: (fn) => fn(),
    setAlarm: async () => assert.fail('unexpected alarm'),
    sql: {
      exec(sql, ...args) {
        if (sql.includes('sqlite_master'))
          return { toArray: () => [{ name: 'gatea_live_once' }] };
        if (sql.startsWith('SELECT scope'))
          return { toArray: () => [{ ...row }] };
        if (sql.includes("SET state='CLAIMED'")) row.state = 'CLAIMED';
        else if (sql.includes('SET receipt=')) row.receipt = args[0];
        else assert.fail('unexpected SQL: ' + sql);
        return {};
      }
    }
  };
  const runtime = new GateAWatchdogDurableObject(
    { storage },
    {
      GATEA_LIVE_ENABLED: 'true',
      GATEA_RECOVERY_DISPATCH_ENABLED: 'true',
      GATEA_OWNER_PUB_SPKI: 'unused',
      GATEA_RUNNER_PUB_SPKI: 'unused',
      GATEA_CONTROLLER_PRIVATE_PKCS8: privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
      GATEA_CONTROLLER_KEY_ID: 'external-controller-02',
      GATEA_GITHUB_ACTIONS_READ_TOKEN: 'a'.repeat(32),
      GATEA_RECOVERY_CONTROLLER: {
        async fetch(request) {
          dispatched = await request.json();
          return new globalThis.Response(
            JSON.stringify({
              status: 'INDEPENDENT_STAGING_STOP_AND_CLEANUP_VERIFIED',
              noPaidRetry: true,
              runId: 3,
              approvalCommentId: 4,
              controllerRunId: 9
            }),
            { headers: { 'content-type': 'application/json' } }
          );
        }
      }
    }
  );
  const result = await runtime.alarmLive();
  assert.equal(result.state, 'CLAIMED');
  assert.equal(dispatched.envelope.proof.runnerHeartbeatAtMs, heartbeat);
  assert.equal(dispatched.envelope.proof.observedAtMs, heartbeat + 16400);
  assert.equal(dispatched.envelope.proof.expiresAtMs, heartbeat + 26400);
  assert.equal(
    JSON.parse(row.receipt).signature,
    dispatched.envelope.signature
  );
});
