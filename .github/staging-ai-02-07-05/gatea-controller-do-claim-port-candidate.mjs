// CODE ONLY: private binding to SAME existing Watchdog DO via legacy fetch.
// No new DO namespace, memory replay store, public route or I/O on import.
import { sign020705PrivateDoClaim } from './gatea-private-claim-auth-candidate.mjs';
const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const SHA = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const K = ['repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'];
const positive = (n) => Number.isSafeInteger(n) && n > 0;
function deny() { throw new Error('AI_020705_PRIVATE_CLAIM_BINDING_NO_GO'); }
function validScope(s) {
  return s && typeof s === 'object' && !Array.isArray(s) &&
    Object.keys(s).length === K.length && K.every((k) => Object.hasOwn(s, k)) &&
    s.repository === REPO && s.stagingProjectRef === STAGING &&
    SHA.test(s.mainSha) && /^dpl_[A-Za-z0-9]+$/u.test(s.previewDeploymentId) &&
    UUID.test(s.actorId) &&
    ['novelId', 'episodeId', 'runId', 'approvalCommentId'].every((k) => positive(s[k]));
}
export function create020705PrivateDoClaimPort({
  namespace, scope, controllerRunId, hmacSecret,
  cryptoImpl = globalThis.crypto, now = Date.now
} = {}) {
  if (!validScope(scope) || !positive(controllerRunId) ||
      controllerRunId === scope.runId ||
      typeof namespace?.idFromName !== 'function' ||
      typeof namespace?.get !== 'function' ||
      typeof hmacSecret !== 'string' || typeof now !== 'function') deny();
  let stub;
  try { stub = namespace.get(namespace.idFromName('ai-020705-' + scope.runId)); }
  catch { deny(); }
  if (typeof stub?.fetch !== 'function') deny();
  async function consume(kind, claim) {
    const permitted = new Set([...K, 'scope', 'contract', 'nonce',
      'controllerKeyId', 'controllerRunId']);
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
        Object.keys(claim).some((key) => !permitted.has(key))) deny();
    const incoming = claim.scope ?? Object.fromEntries(K.map((key) => [key, claim[key]]));
    const contract = kind === 'RECOVERY'
      ? 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1'
      : kind === 'ARM_RECEIPT'
        ? 'NOVELIGHT_AI_020705_ARM_RECEIPT_ONE_USE_V1' : undefined;
    if (!validScope(incoming) || !K.every((key) => incoming[key] === scope[key]) ||
        !NONCE.test(claim.nonce ?? '') ||
        (contract === undefined ? claim.contract !== undefined :
          claim.contract !== contract) ||
        (claim.controllerRunId != null && claim.controllerRunId !== controllerRunId))
      deny();
    try {
      const auth = await sign020705PrivateDoClaim({
        kind, scope, nonce: claim.nonce, controllerRunId,
        secret: hmacSecret, cryptoImpl, now
      });
      const response = await stub.fetch(new globalThis.Request(
        'https://gatea-do.internal/_novelight/gatea/claim', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(auth)
        }
      ));
      if (response?.status !== 200 ||
          response.headers?.get('content-type') !== 'application/json') deny();
      const raw = await response.text();
      if (!raw || raw.length > 512) deny();
      const result = JSON.parse(raw);
      return result?.claimed === true && result.kind === kind &&
        result.runId === scope.runId &&
        result.approvalCommentId === scope.approvalCommentId &&
        result.controllerRunId === controllerRunId;
    } catch { deny(); }
  }
  return Object.freeze({
    claimArmOnce: (claim) => consume('ARM', claim),
    claimArmReceiptOnce: (claim) => consume('ARM_RECEIPT', claim),
    claimRecoveryOnce: (claim) => consume('RECOVERY', claim)
  });
}
