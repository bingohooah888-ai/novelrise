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
  await assert.rejects(runtime.alarm(), /CLOUDFLARE_LIVE_NO_GO/);
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
