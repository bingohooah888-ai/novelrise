// Actual HTTPS transport for a separately authorized pre-started GitHub runner.
// Does not start workflows, issue credentials, or authorize any Staging change.
import { verify020705SignedRunnerDeath } from './signed-runner-death-offline.mjs';

function deny() { throw new Error('AI_020705_ACCESS_CLIENT_NO_GO'); }
export function create020705AccessRecoveryClient({
  origin, clientId, clientSecret, ownerSignature, scope, controllerRunId,
  trustedControllerPublicKey, trustedControllerKeyId, expectedChallengeNonce,
  fetchImpl = globalThis.fetch, now = Date.now
} = {}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username ||
      url.password || !clientId?.endsWith('.access') ||
      typeof clientSecret !== 'string' || !clientSecret ||
      !/^[A-Za-z0-9_-]{86}$/u.test(ownerSignature ?? '') ||
      !scope || scope.repository !== 'bingohooah888-ai/novelrise' ||
      scope.stagingProjectRef !== 'wmlzjgvxgoyrovdhbqbg' ||
      !Number.isSafeInteger(controllerRunId) || controllerRunId <= 0 ||
      controllerRunId === scope.runId) deny();
  let receipt;
  let attempted = false;
  async function request(body) {
    try {
      const response = await fetchImpl(origin + '/_novelight/gatea/relay', {
        method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { 'content-type': 'application/json',
          'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret },
        body: JSON.stringify({ ...body, ownerSignature }),
        signal: globalThis.AbortSignal.timeout(4000)
      });
      if (response.status !== 200) deny();
      const raw = await response.text();
      if (raw.length > 4096) deny();
      return JSON.parse(raw);
    } catch { deny(); }
  }
  function valid(envelope) {
    if (!verify020705SignedRunnerDeath({ envelope, trustedControllerPublicKey,
      trustedControllerKeyId, expectedChallengeNonce })) return false;
    const p = envelope.proof;
    const time = now();
    return Object.keys(scope).every((key) => scope[key] === p[key]) &&
      p.kind === 'detached-controller-runner-death' &&
      p.runnerConfirmedDead === true && p.controllerIsRunner === false &&
      p.controllerRunId === controllerRunId && Number.isFinite(time) &&
      p.observedAtMs <= time && p.expiresAtMs > time &&
      p.expiresAtMs - p.observedAtMs <= 10000 &&
      p.runnerHeartbeatAtMs > 0 && p.observedAtMs - p.runnerHeartbeatAtMs >= 250;
  }
  return Object.freeze({
    async readIndependentDeathProof(expectedScope) {
      if (attempted || !expectedScope || Object.keys(expectedScope).length !== Object.keys(scope).length ||
          !Object.keys(scope).every((k) => scope[k] === expectedScope[k])) deny();
      const result = await request({ op: 'receipt' });
      if (!valid(result.envelope)) deny();
      receipt = result.envelope;
      return receipt;
    },
    async claimRecoveryOnce(claim) {
      if (attempted || !receipt || !valid(receipt) ||
          claim?.contract !== 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1' ||
          claim.nonce !== expectedChallengeNonce ||
          claim.controllerKeyId !== trustedControllerKeyId ||
          !Object.keys(scope).every((k) => claim[k] === scope[k])) deny();
      attempted = true;
      const result = await request({ op: 'claim', receiptSignature: receipt.signature });
      return result.claimed === true && result.runId === scope.runId &&
        result.approvalCommentId === scope.approvalCommentId &&
        result.controllerRunId === controllerRunId && valid(receipt);
    }
  });
}
