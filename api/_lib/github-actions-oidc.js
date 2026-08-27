import { createPublicKey, verify } from 'node:crypto';

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;

function decodeJsonSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid GitHub OIDC ${label}`);
  }
}

function audienceMatches(actual, expected) {
  if (Array.isArray(actual)) return actual.includes(expected);
  return actual === expected;
}

function assertClaim(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Unexpected GitHub OIDC ${label}`);
  }
}

export async function verifyGitHubActionsOidcToken(
  token,
  {
    audience,
    repository,
    ref,
    workflowRef,
    fetchImpl = fetch,
    now = Date.now()
  }
) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing GitHub OIDC token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid GitHub OIDC token');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader, 'header');
  const claims = decodeJsonSegment(encodedPayload, 'payload');

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported GitHub OIDC signing metadata');
  }

  const jwksResponse = await fetchImpl(GITHUB_OIDC_JWKS_URL, {
    headers: { accept: 'application/json' }
  });
  if (!jwksResponse.ok) {
    throw new Error('Unable to load GitHub OIDC signing keys');
  }

  const jwks = await jwksResponse.json();
  const jwk = (jwks.keys || []).find((item) => item.kid === header.kid);
  if (!jwk) {
    throw new Error('GitHub OIDC signing key not found');
  }

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const signatureValid = verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    Buffer.from(encodedSignature, 'base64url')
  );
  if (!signatureValid) {
    throw new Error('Invalid GitHub OIDC signature');
  }

  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) {
    throw new Error('Expired GitHub OIDC token');
  }
  if (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + 30) {
    throw new Error('GitHub OIDC token is not active yet');
  }

  assertClaim(claims.iss, GITHUB_OIDC_ISSUER, 'issuer');
  if (!audienceMatches(claims.aud, audience)) {
    throw new Error('Unexpected GitHub OIDC audience');
  }
  assertClaim(claims.repository, repository, 'repository');
  assertClaim(claims.ref, ref, 'ref');
  assertClaim(claims.workflow_ref, workflowRef, 'workflow_ref');

  return claims;
}
