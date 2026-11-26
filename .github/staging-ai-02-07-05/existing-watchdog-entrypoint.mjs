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
  return Object.freeze({
    async recover() {
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
      return create020705DetachedStopConnector({
        ...stopOptions, scope, controllerRunId
      }).recover();
    }
  });
}
