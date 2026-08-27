import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { verifyGitHubActionsOidcToken } from '../api/_lib/github-actions-oidc.js';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'novelight-production-billing-guard';
const repository = 'bingohooah888-ai/novelrise';
const ref = 'refs/heads/main';
const workflowRef =
  'bingohooah888-ai/novelrise/.github/workflows/production-billing-guard.yml@refs/heads/main';
const now = 1_787_823_600_000;

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
});
const publicJwk = publicKey.export({ format: 'jwk' });
publicJwk.kid = 'test-key';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createToken(overrides = {}) {
  const header = encodeJson({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = encodeJson({
    iss: issuer,
    aud: audience,
    repository,
    ref,
    workflow_ref: workflowRef,
    exp: Math.floor(now / 1000) + 300,
    nbf: Math.floor(now / 1000) - 30,
    ...overrides
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function fetchJwks() {
  return {
    ok: true,
    async json() {
      return { keys: [publicJwk] };
    }
  };
}

const expected = {
  audience,
  repository,
  ref,
  workflowRef,
  fetchImpl: fetchJwks,
  now
};

test('accepts a signed token from the exact main workflow', async () => {
  const claims = await verifyGitHubActionsOidcToken(createToken(), expected);

  assert.equal(claims.repository, repository);
  assert.equal(claims.ref, ref);
});

test('rejects a token from a different workflow', async () => {
  await assert.rejects(
    verifyGitHubActionsOidcToken(
      createToken({
        workflow_ref:
          'bingohooah888-ai/novelrise/.github/workflows/ci.yml@refs/heads/main'
      }),
      expected
    ),
    /workflow_ref/
  );
});

test('rejects a token from a non-main ref', async () => {
  await assert.rejects(
    verifyGitHubActionsOidcToken(
      createToken({ ref: 'refs/heads/feature/not-production' }),
      expected
    ),
    /ref/
  );
});

test('rejects an expired token', async () => {
  await assert.rejects(
    verifyGitHubActionsOidcToken(
      createToken({ exp: Math.floor(now / 1000) - 1 }),
      expected
    ),
    /Expired/
  );
});
