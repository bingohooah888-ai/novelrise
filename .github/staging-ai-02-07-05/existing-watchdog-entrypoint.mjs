// Existing Cloudflare Worker + DO entry for an OUT-OF-RUNNER process only.
// No Cloudflare transport, deployment, secret, HTTP or scheduler is created.
import { create020705DetachedStopConnector } from './detached-stop-connector.mjs';

const ACCOUNT = '6831b18fe814232fa2dd4c470b95aa15';
const WORKER = 'novelight-ai-gatea-watchdog';
const NAMESPACE = '015ef5be967f4fbfbad31ab24a22bf26';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const REPOSITORY = 'bingohooah888-ai/novelrise';
const positive = (x) => Number.isSafeInteger(x) && x > 0;
function deny() { throw new Error('AI_020705_EXISTING_WATCHDOG_ENTRY_DENIED'); }

// A separately deployed, authenticated controller must provide this read.
// NLO's current cloudflare_watchdog_status is metadata-only and always NO_GO;
// it must never be used as proof of kill, revocation, or zero census.
export function create020705ExistingWatchdogEntrypoint({
  scope, controllerRunId, readControllerCapabilities, stopOptions
} = {}) {
  if (
    scope?.repository !== REPOSITORY ||
    scope?.stagingProjectRef !== STAGING ||
    !/^dpl_[A-Za-z0-9]+$/u.test(scope?.previewDeploymentId ?? '') ||
    !/^[0-9a-f]{40}$/u.test(scope?.mainSha ?? '') ||
    !positive(scope?.runId) ||
    !positive(scope?.approvalCommentId) ||
    !positive(controllerRunId) || controllerRunId === scope.runId ||
    typeof readControllerCapabilities !== 'function' ||
    !stopOptions || typeof stopOptions !== 'object' || Array.isArray(stopOptions)
  ) deny();
  let attempted = false;
  async function recoverWithReceipt(verifiedNotice = null) {
      if (attempted) deny();
      attempted = true;
      let observed;
      try {
        observed = await readControllerCapabilities(Object.freeze({
          accountId: ACCOUNT, workerName: WORKER,
          namespaceId: NAMESPACE, projectRef: STAGING,
          runId: scope.runId, controllerRunId
        }));
      } catch { deny(); }
      if (
        observed?.verifiedIndependentSource !== true ||
        observed?.accountId !== ACCOUNT ||
        observed?.workerName !== WORKER ||
        observed?.namespaceId !== NAMESPACE ||
        observed?.projectRef !== STAGING ||
        observed?.runId !== scope.runId ||
        observed?.controllerRunId !== controllerRunId ||
        observed?.separateFromRunner !== true ||
        observed?.signedDeathProofAvailable !== true ||
        observed?.atomicRecoveryClaimAvailable !== true ||
        observed?.stagingStopAuthorityVerified !== true ||
        observed?.syntheticRevocationVerified !== true ||
        observed?.independentCensusVerified !== true
      ) deny();
      // Existing connector verifies signed death / scope / one-use nonce,
      // then executes stop -> cleanup -> independent zero census. Never
      // recover on heartbeat expiry or controller metadata alone.
      // A signed death notification comes from the existing Cloudflare
      // DO; its Ed25519 signature is independently checked by the existing
      // detached-stop connector BEFORE any stop/cleanup callback.
      const stop = verifiedNotice === null
        ? stopOptions
        : {
            ...stopOptions,
            readIndependentDeathProof: async () => verifiedNotice
          };
      return create020705DetachedStopConnector({
        ...stop, scope, controllerRunId
      }).recover();
  }

  return Object.freeze({
    recover: () => recoverWithReceipt(),

    /**
     * To be mounted ONLY behind an independently protected Cloudflare
     * service binding. Not an HTTP/public endpoint in this module.
     * Does not trust caller claims of death, controller authority or cleanup;
     * the existing connector verifies signed death, durable one-use claim,
     * stop, session revoke, synthetic deletion and independent census.
     */
    async handleRecoveryRequest(request) {
      const denied = () => new Response(null, {
        status: 404, headers: { 'cache-control': 'no-store' }
      });
      if (attempted || request?.method !== 'POST' ||
          new globalThis.URL(request.url).pathname !==
            '/_novelight/gatea/recover' ||
          request.headers?.get?.('content-type') !== 'application/json')
        return denied();

      let notice;
      try {
        const body = await request.text();
        if (body.length < 1 || body.length > 4096) return denied();
        notice = JSON.parse(body);
      } catch { return denied(); }
      const fields = [
        'repository', 'stagingProjectRef', 'mainSha',
        'previewDeploymentId', 'actorId', 'novelId',
        'episodeId', 'runId', 'approvalCommentId'
      ];
      if (!notice || typeof notice !== 'object' ||
          Object.keys(notice).sort().join(',') !== 'envelope,scope' ||
          !notice.scope || typeof notice.scope !== 'object' ||
          Object.keys(notice.scope).sort().join(',') !==
            [...fields].sort().join(',') ||
          fields.some((key) => notice.scope[key] !== scope[key]) ||
          notice.envelope?.domain !==
            'NOVELIGHT_AI_020705_DETACHED_DEATH_V1' ||
          fields.some((key) =>
            notice.envelope?.proof?.[key] !== scope[key]
          ) ||
          notice.envelope?.proof?.controllerRunId !== controllerRunId
      ) return denied();

      try {
        const outcome = await recoverWithReceipt(notice.envelope);
        if (outcome?.status !==
              'INDEPENDENT_STAGING_STOP_AND_CLEANUP_VERIFIED' ||
            outcome.noPaidRetry !== true) return denied();
        return new Response(JSON.stringify({
          status: outcome.status,
          noPaidRetry: true,
          runId: scope.runId,
          approvalCommentId: scope.approvalCommentId,
          controllerRunId
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          }
        });
      } catch { return denied(); }
    }
  });
}
