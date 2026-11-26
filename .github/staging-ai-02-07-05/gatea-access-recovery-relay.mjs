// Existing Controller's Access-protected receipt/claim relay. No DB, provider,
// Auth, or cleanup credentials live here. Flags and routes remain OFF until
// separate OWNER deployment approval. Never treat receipt availability as STOP.
import { createPublicKey } from 'node:crypto';
import { verify020705SignedRunnerDeath } from './signed-runner-death-offline.mjs';
import { create020705PrivateDoClaimPort } from './gatea-controller-do-claim-port-candidate.mjs';

const PATH = '/_novelight/gatea/relay';
const FIELDS = ['repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'];
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const SIG = /^[A-Za-z0-9_-]{86}$/u;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
function deny() { throw new Error('AI_020705_ACCESS_RELAY_NO_GO'); }
function sameScope(a, b) {
  return a && b && Object.keys(a).length === FIELDS.length &&
    Object.keys(b).length === FIELDS.length &&
    FIELDS.every((k) => Object.hasOwn(a, k) && a[k] === b[k]);
}
function configured(env) {
  if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
      env?.GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED !== 'true') deny();
  const scope = JSON.parse(env.GATEA_RECOVERY_SCOPE_JSON);
  const controllerRunId = Number(env.GATEA_CONTROLLER_RUN_ID);
  const nonce = env.GATEA_RECOVERY_NONCE;
  const keyId = env.GATEA_DEATH_KEY_ID;
  if (!sameScope(scope, scope) || scope.repository !== 'bingohooah888-ai/novelrise' ||
      scope.stagingProjectRef !== 'wmlzjgvxgoyrovdhbqbg' ||
      !/^[a-f0-9]{40}$/u.test(scope.mainSha) ||
      !/^dpl_[A-Za-z0-9]+$/u.test(scope.previewDeploymentId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(scope.actorId) ||
      !['novelId', 'episodeId', 'runId', 'approvalCommentId'].every((k) => positive(scope[k])) ||
      !positive(controllerRunId) || controllerRunId === scope.runId ||
      !NONCE.test(nonce ?? '') || !/^[A-Za-z0-9_-]{8,64}$/u.test(keyId ?? '')) deny();
  const key = createPublicKey({
    key: Buffer.from(env.GATEA_DEATH_PUB_SPKI, 'base64'), format: 'der', type: 'spki'
  });
  if (key.asymmetricKeyType !== 'ed25519') deny();
  return { scope, controllerRunId, nonce, keyId, key };
}
function fresh(envelope, cfg, now) {
  if (!verify020705SignedRunnerDeath({
    envelope, trustedControllerPublicKey: cfg.key,
    trustedControllerKeyId: cfg.keyId, expectedChallengeNonce: cfg.nonce
  })) return false;
  const p = envelope.proof;
  return FIELDS.every((k) => p[k] === cfg.scope[k]) &&
    p.kind === 'detached-controller-runner-death' &&
    p.runnerConfirmedDead === true && p.controllerIsRunner === false &&
    p.controllerRunId === cfg.controllerRunId &&
    [p.observedAtMs, p.runnerHeartbeatAtMs, p.expiresAtMs, now].every(positive) &&
    p.observedAtMs <= now && p.expiresAtMs > now &&
    p.expiresAtMs - p.observedAtMs <= 10000 &&
    p.observedAtMs - p.runnerHeartbeatAtMs >= 250;
}
function b64(s) {
  if (!/^[A-Za-z0-9_-]+$/u.test(s)) deny();
  return Buffer.from(s, 'base64url');
}
// Verify the Access application assertion, not a caller-supplied identity header.
// Only the fixed account issuer's published RS256 keys and pinned service token
// Client ID are accepted. See Cloudflare Access application token docs.
export async function verify020705AccessAssertion({ token, env,
  fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  try {
    const issuer = env.GATEA_ACCESS_ISSUER;
    const aud = env.GATEA_ACCESS_AUD;
    const client = env.GATEA_ACCESS_CLIENT_ID;
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/u.test(issuer ?? '') ||
        !/^[a-f0-9]{64}$/u.test(aud ?? '') ||
        typeof client !== 'string' || !client.endsWith('.access') ||
        typeof token !== 'string' || token.length > 8192) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [h, p, sig] = parts;
    const header = JSON.parse(b64(h).toString('utf8'));
    const claims = JSON.parse(b64(p).toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
        claims.iss !== issuer || !Array.isArray(claims.aud) ||
        !claims.aud.includes(aud) || claims.common_name !== client ||
        claims.type !== 'app' || claims.sub !== '' || !positive(claims.iat) || !positive(claims.exp)) return false;
    const response = await fetchImpl(issuer + '/cdn-cgi/access/certs', {
      method: 'GET', redirect: 'error'
    });
    if (response.status !== 200) return false;
    const raw = await response.text();
    if (raw.length > 65536) return false;
    const keys = JSON.parse(raw).keys;
    const matches = Array.isArray(keys) ? keys.filter((k) =>
      k.kid === header.kid && k.kty === 'RSA' && k.alg === 'RS256') : [];
    if (matches.length !== 1) return false;
    const key = await globalThis.crypto.subtle.importKey('jwk', matches[0],
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await globalThis.crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      key, b64(sig), new TextEncoder().encode(h + '.' + p))) return false;
    const seconds = Math.floor(now() / 1000);
    return positive(seconds) && claims.iat <= seconds && claims.exp > seconds &&
      (claims.nbf === undefined || (positive(claims.nbf) && claims.nbf <= seconds));
  } catch { return false; }
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function blocked() { return new Response(null, { status: 404,
  headers: { 'cache-control': 'no-store' } }); }
export default Object.freeze({
  async fetch(request, env) {
    try {
      const cfg = configured(env);
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.search || url.hash ||
          request.headers.get('content-type') !== 'application/json') return blocked();
      // Private service-binding notification is an acknowledgement ONLY.
      if (url.origin === 'https://gatea-recovery.internal' &&
          url.pathname === '/_novelight/gatea/recover') {
        const raw = await request.text();
        if (raw.length > 4096) return blocked();
        const notice = JSON.parse(raw);
        if (!sameScope(notice.scope, cfg.scope) || !fresh(notice.envelope, cfg, Date.now()))
          return blocked();
        return json({ status: 'SIGNED_DEATH_RECEIPT_AVAILABLE', noPaidRetry: true,
          runId: cfg.scope.runId, approvalCommentId: cfg.scope.approvalCommentId,
          controllerRunId: cfg.controllerRunId }, 202);
      }
      if (url.origin !== env.GATEA_ACCESS_ORIGIN || url.protocol !== 'https:' ||
          url.pathname !== PATH ||
          !await verify020705AccessAssertion({
            token: request.headers.get('cf-access-jwt-assertion'), env
          })) return blocked();
      const raw = await request.text();
      if (raw.length > 4096) return blocked();
      const body = JSON.parse(raw);
      if (!['receipt', 'claim'].includes(body.op) ||
          Object.keys(body).sort().join(',') !==
            (body.op === 'receipt' ? 'op,ownerSignature' : 'op,ownerSignature,receiptSignature') ||
          !SIG.test(body.ownerSignature ?? '')) return blocked();
      const namespace = env.GATEA_CLAIM_LEDGER;
      const stub = namespace.get(namespace.idFromName('ai-020705-' + cfg.scope.runId));
      const response = await stub.fetch(new Request(
        'https://gatea-do.internal/_novelight/gatea/receipt', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: cfg.scope, nonce: cfg.nonce,
            signature: body.ownerSignature })
        }));
      if (response.status !== 200) return blocked();
      const stored = await response.text();
      if (stored.length > 4096) return blocked();
      const { envelope } = JSON.parse(stored);
      if (!fresh(envelope, cfg, Date.now())) return blocked();
      if (body.op === 'receipt') return json({ envelope });
      if (body.receiptSignature !== envelope.signature) return blocked();
      const port = create020705PrivateDoClaimPort({
        namespace, scope: cfg.scope, controllerRunId: cfg.controllerRunId,
        hmacSecret: env.GATEA_CLAIM_HMAC_KEY
      });
      const claimed = await port.claimRecoveryOnce({
        contract: 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1',
        scope: cfg.scope, nonce: cfg.nonce, controllerRunId: cfg.controllerRunId,
        controllerKeyId: cfg.keyId
      });
      if (!claimed || !fresh(envelope, cfg, Date.now())) return blocked();
      return json({ claimed: true, runId: cfg.scope.runId,
        approvalCommentId: cfg.scope.approvalCommentId, controllerRunId: cfg.controllerRunId });
    } catch { return blocked(); }
  }
});
