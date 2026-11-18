// CODE ONLY. Authenticate private cross-Worker DO fetch by HMAC-SHA256.
// No public route, default credentials, network or I/O on import.
const DOMAIN = 'NOVELIGHT_AI_020705_PRIVATE_DO_CLAIM_V1';
const KEYS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
const CONTRACT = ['ARM', 'ARM_RECEIPT', 'RECOVERY'];
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const MAC = /^[A-Za-z0-9_-]{43}$/u;
function deny() { throw new Error('AI_020705_PRIVATE_DO_MAC_NO_GO'); }
function valid(input) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    CONTRACT.includes(input.kind) &&
    input.scope && typeof input.scope === 'object' &&
    Object.keys(input.scope).length === KEYS.length &&
    KEYS.every((k) => Object.hasOwn(input.scope, k)) &&
    NONCE.test(input.nonce ?? '') &&
    Number.isSafeInteger(input.controllerRunId) && input.controllerRunId > 0 &&
    input.controllerRunId !== input.scope.runId &&
    Number.isSafeInteger(input.issuedAtMs) && input.issuedAtMs > 0;
}
function bytes(input) {
  if (!MAC.test(input ?? '')) deny();
  const chars = atob(input.replace(/-/gu, '+').replace(/_/gu, '/') + '=');
  if (chars.length !== 32) deny();
  return Uint8Array.from(chars, (ch) => ch.charCodeAt(0));
}
function encode(data) {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
function message(input) {
  return new TextEncoder().encode(JSON.stringify([
    DOMAIN, input.kind, KEYS.map((k) => input.scope[k]),
    input.nonce, input.controllerRunId, input.issuedAtMs
  ]));
}
async function hmacKey(secret, cryptoImpl) {
  if (!cryptoImpl?.subtle) deny();
  return cryptoImpl.subtle.importKey('raw', bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function sign020705PrivateDoClaim({
  kind, scope, nonce, controllerRunId,
  secret, cryptoImpl = globalThis.crypto, now = Date.now
} = {}) {
  const issuedAtMs = now();
  const payload = { kind, scope, nonce, controllerRunId, issuedAtMs };
  if (!valid(payload)) deny();
  try {
    const key = await hmacKey(secret, cryptoImpl);
    const mac = encode(await cryptoImpl.subtle.sign('HMAC', key, message(payload)));
    return Object.freeze({ ...payload, mac });
  } catch { deny(); }
}
export async function verify020705PrivateDoClaim({
  payload, secret, cryptoImpl = globalThis.crypto, now = Date.now
} = {}) {
  try {
    if (!payload || Object.keys(payload).sort().join(',') !==
          'controllerRunId,issuedAtMs,kind,mac,nonce,scope' ||
        !valid(payload) || !MAC.test(payload.mac ?? '')) return false;
    const time = now();
    if (!Number.isSafeInteger(time) || payload.issuedAtMs > time + 2000 ||
        time - payload.issuedAtMs > 10000) return false;
    const key = await hmacKey(secret, cryptoImpl);
    return await cryptoImpl.subtle.verify('HMAC', key,
      bytes(payload.mac), message(payload));
  } catch { return false; }
}
