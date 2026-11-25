import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import relay, {
  verify020705AccessAssertion
} from '../.github/staging-ai-02-07-05/gatea-access-recovery-relay.mjs';
import { create020705AccessRecoveryClient } from '../.github/staging-ai-02-07-05/gatea-access-recovery-client.mjs';
import { verify020705PrivateDoClaim } from '../.github/staging-ai-02-07-05/gatea-private-claim-auth-candidate.mjs';

const NOW = 1800000000000;
const scope = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_test',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 1,
  episodeId: 2,
  runId: 3,
  approvalCommentId: 4
};
const death = generateKeyPairSync('ed25519');
const access = generateKeyPairSync('rsa', { modulusLength: 2048 });
const nonce = 'n'.repeat(44);
const kid = 'death-key-01';
const issuer = 'https://fixture.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const clientId = 'fixture.access';
const origin = 'https://relay.example.invalid';
const secret = Buffer.alloc(32, 7).toString('base64url');
const ownerSignature = 'x'.repeat(86);
const jwk = {
  ...access.publicKey.export({ format: 'jwk' }),
  kid: 'access-key',
  alg: 'RS256'
};
const env = {
  GATEA_CONTROLLER_LIVE_ENABLED: 'true',
  GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED: 'true',
  GATEA_RECOVERY_SCOPE_JSON: JSON.stringify(scope),
  GATEA_CONTROLLER_RUN_ID: '9',
  GATEA_RECOVERY_NONCE: nonce,
  GATEA_DEATH_KEY_ID: kid,
  GATEA_DEATH_PUB_SPKI: death.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64'),
  GATEA_ACCESS_ISSUER: issuer,
  GATEA_ACCESS_AUD: audience,
  GATEA_ACCESS_CLIENT_ID: clientId,
  GATEA_ACCESS_ORIGIN: origin,
  GATEA_CLAIM_HMAC_KEY: secret
};
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
function assertion(patch = {}) {
  const header = encode({ alg: 'RS256', kid: 'access-key' });
  const claims = encode({
    iss: issuer,
    aud: [audience],
    type: 'app',
    common_name: clientId,
    sub: '',
    iat: NOW / 1000 - 1,
    exp: NOW / 1000 + 60,
    ...patch
  });
  const data = header + '.' + claims;
  return (
    data +
    '.' +
    sign('RSA-SHA256', Buffer.from(data), access.privateKey).toString(
      'base64url'
    )
  );
}
function envelope() {
  const proof = {
    ...scope,
    kind: 'detached-controller-runner-death',
    runnerConfirmedDead: true,
    controllerIsRunner: false,
    controllerRunId: 9,
    observedAtMs: NOW,
    runnerHeartbeatAtMs: NOW - 16000,
    expiresAtMs: NOW + 10000
  };
  const domain = 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1';
  return {
    domain,
    keyId: kid,
    challengeNonce: nonce,
    proof,
    signature: sign(
      null,
      Buffer.from(JSON.stringify([domain, kid, nonce, proof])),
      death.privateKey
    ).toString('base64url')
  };
}
const json = (value) =>
  new globalThis.Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
const certs = async (url) => {
  assert.equal(url, issuer + '/cdn-cgi/access/certs');
  return json({ keys: [jwk] });
};

test('Access assertion pins issuer, audience and service identity', async () => {
  const args = { env, now: () => NOW, fetchImpl: certs };
  assert.equal(
    await verify020705AccessAssertion({ ...args, token: assertion() }),
    true
  );
  for (const patch of [
    { aud: ['b'.repeat(64)] },
    { common_name: 'other.access' },
    { sub: 'human' },
    { exp: NOW / 1000 },
    { iat: NOW / 1000 + 1 }
  ]) {
    assert.equal(
      await verify020705AccessAssertion({ ...args, token: assertion(patch) }),
      false
    );
  }
  const token = assertion();
  const broken = token.slice(0, -2) + 'AA';
  assert.equal(
    await verify020705AccessAssertion({ ...args, token: broken }),
    false
  );
});

test('relay exchanges signed receipt and HMAC claim without certifying cleanup', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', certs);
  const stored = envelope();
  let claimed = false;
  let reads = 0;
  const bound = {
    ...env,
    GATEA_CLAIM_LEDGER: {
      idFromName(name) {
        assert.equal(name, 'ai-020705-3');
        return name;
      },
      get() {
        return {
          async fetch(request) {
            const body = await request.json();
            if (request.url.endsWith('/receipt')) {
              reads++;
              assert.equal(body.signature, ownerSignature);
              assert.deepEqual(body.scope, scope);
              assert.equal(body.nonce, nonce);
              return json({ envelope: stored });
            }
            assert.equal(
              await verify020705PrivateDoClaim({
                payload: body,
                secret,
                now: () => NOW
              }),
              true
            );
            if (claimed) return new globalThis.Response(null, { status: 404 });
            claimed = true;
            return json({
              claimed: true,
              kind: 'RECOVERY',
              runId: 3,
              approvalCommentId: 4,
              controllerRunId: 9
            });
          }
        };
      }
    }
  };
  const request = new globalThis.Request(origin + '/_novelight/gatea/relay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'receipt', ownerSignature })
  });
  assert.equal((await relay.fetch(request, bound)).status, 404);
  assert.equal(reads, 0);
  const notice = new globalThis.Request(
    'https://gatea-recovery.internal/_novelight/gatea/recover',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, envelope: stored })
    }
  );
  const ack = await relay.fetch(notice, bound);
  assert.equal(ack.status, 202);
  assert.equal((await ack.json()).status, 'SIGNED_DEATH_RECEIPT_AVAILABLE');
  assert.equal(claimed, false);
  const client = create020705AccessRecoveryClient({
    origin,
    clientId,
    clientSecret: 'fixture-only',
    ownerSignature,
    scope,
    controllerRunId: 9,
    trustedControllerPublicKey: death.publicKey,
    trustedControllerKeyId: kid,
    expectedChallengeNonce: nonce,
    now: () => NOW,
    async fetchImpl(url, options) {
      assert.equal(options.headers['CF-Access-Client-Id'], clientId);
      return relay.fetch(
        new globalThis.Request(url, {
          method: options.method,
          body: options.body,
          headers: {
            'content-type': 'application/json',
            'cf-access-jwt-assertion': assertion()
          }
        }),
        bound
      );
    }
  });
  assert.deepEqual(await client.readIndependentDeathProof(scope), stored);
  const claim = {
    contract: 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1',
    ...scope,
    controllerKeyId: kid,
    nonce
  };
  assert.equal(await client.claimRecoveryOnce(claim), true);
  assert.equal(claimed, true);
  await assert.rejects(client.claimRecoveryOnce(claim), /ACCESS_CLIENT_NO_GO/u);
});
