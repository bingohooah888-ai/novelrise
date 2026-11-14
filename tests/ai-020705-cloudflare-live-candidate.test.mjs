import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { GateAWatchdogDurableObject, inspect020705CloudflareGithubExit, verify020705CloudflareSignature } from '../.github/staging-ai-02-07-05/cloudflare-gatea-live-candidate.mjs';
import { create020705TrustedMainRuntime } from '../.github/staging-ai-02-07-05/trusted-main-live-runtime.mjs';

const sha = 'a'.repeat(40);
const scope = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: sha,
  previewDeploymentId: 'dpl_HscqVwRoSCxBAt9C3LHLof5971L9',
  actorId: '12345678-1234-4234-8234-123456789abc',
  novelId: 1, episodeId: 2, runId: 3, approvalCommentId: 4
};
test('candidate preserves closed public fetch and disabled runtime', async () => {
  const runtime = new GateAWatchdogDurableObject({}, {});
  assert.equal((await runtime.fetch()).status, 404);
  await assert.rejects(runtime.arm(), /CLOUDFLARE_LIVE_NO_GO/);
  await assert.rejects(runtime.heartbeat(), /CLOUDFLARE_LIVE_NO_GO/);
  await assert.rejects(runtime.alarm(), /CLOUDFLARE_LIVE_NO_GO/);
});
test('owner arm requires actual pinned Ed25519 signature', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const domain = 'NOVELIGHT_AI_020705_OWNER_ARM_V1';
  const payload = { scope, nonce: 'x'.repeat(40), controllerRunId: 9, expiresAtMs: 1234 };
  const signature = sign(null, Buffer.from(JSON.stringify([domain, payload])), privateKey).toString('base64url');
  const pinnedSpkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const ok = await verify020705CloudflareSignature({
    domain, payload, signature, pinnedSpkiBase64, cryptoImpl: webcrypto
  });
  assert.equal(ok, true);
  assert.equal(await verify020705CloudflareSignature({
    domain, payload: { ...payload, controllerRunId: 10 },
    signature, pinnedSpkiBase64, cryptoImpl: webcrypto
  }), false);
});
test('independent GitHub evidence rejects active runs, other owners and other branches', async () => {
  const run = {
    id: 3, head_sha: sha, head_branch: 'main',
    path: '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
    repository: { full_name: 'bingohooah888-ai/novelrise' },
    actor: { login: 'bingohooah888-ai' },
    triggering_actor: { login: 'bingohooah888-ai' },
    event: 'workflow_dispatch', run_attempt: 1,
    status: 'completed', conclusion: 'cancelled'
  };
  const jobs = { total_count: 1, jobs: [{ run_id: 3, status: 'completed' }] };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => url.includes('?per_page=100') ? jobs : run });
  assert.equal((await inspect020705CloudflareGithubExit({
    scope, readToken: 'a'.repeat(32), fetchImpl
  })).independentGithubExitVerified, true);
  await assert.rejects(inspect020705CloudflareGithubExit({
    scope, readToken: 'a'.repeat(32),
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => url.includes('?per_page=100') ? jobs : { ...run, status: 'in_progress' }
    })
  }), /CLOUDFLARE_LIVE_NO_GO/);
  await assert.rejects(inspect020705CloudflareGithubExit({
    scope, readToken: 'a'.repeat(32),
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => url.includes('?per_page=100') ? jobs : { ...run, head_branch: 'production' }
    })
  }), /CLOUDFLARE_LIVE_NO_GO/);
});
test('trusted main and detached recovery reject unavailable capabilities', () => {
  assert.throws(() => create020705TrustedMainRuntime(), /TRUSTED_RUNTIME_WIRING_DENIED/);
});
