// Code-only trusted-main / detached-controller wire-up.
// Requires an independently authenticated Cloudflare service/receipt reader.
// No workflow, transport, secret or runtime is started by this module.
import { create020705OwnerStagingLiveEntrypoint } from
  '../ai-02-07-05-app-composition/owner-staging-live-entrypoint.mjs';
import { create020705ExistingWatchdogEntrypoint } from
  './existing-watchdog-entrypoint.mjs';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const WORKER = 'novelight-ai-gatea-watchdog';
const NAMESPACE = '015ef5be967f4fbfbad31ab24a22bf26';
function deny() { throw new Error('AI_020705_TRUSTED_RUNTIME_WIRING_DENIED'); }
export function create020705TrustedMainRuntime({ runner, recovery } = {}) {
  if (!runner || typeof runner !== 'object' || !recovery ||
      typeof recovery !== 'object' || Array.isArray(recovery)) deny();
  const owner = create020705OwnerStagingLiveEntrypoint(runner);
  if (recovery.scope?.stagingProjectRef !== STAGING ||
      recovery.scope?.repository !== runner.context?.repository ||
      recovery.scope?.mainSha !== runner.context?.mainSha ||
      recovery.scope?.previewDeploymentId !== runner.context?.previewDeploymentId ||
      recovery.scope?.runId !== runner.context?.runId ||
      recovery.scope?.approvalCommentId !== runner.context?.approvalCommentId ||
      typeof recovery.readAuthenticatedReceipt !== 'function' ||
      typeof recovery.readControllerCapabilities !== 'function' ||
      !recovery.pinnedControllerPublicKey ||
      !recovery.pinnedControllerKeyId ||
      !recovery.expectedChallengeNonce) deny();
  const readControllerCapabilities = async (query) => {
    const result = await recovery.readControllerCapabilities(query);
    if (result?.workerName !== WORKER ||
        result?.namespaceId !== NAMESPACE ||
        result?.verifiedIndependentSource !== true ||
        result?.separateFromRunner !== true ||
        result?.signedDeathProofAvailable !== true ||
        result?.atomicRecoveryClaimAvailable !== true ||
        result?.stagingStopAuthorityVerified !== true ||
        result?.syntheticRevocationVerified !== true ||
        result?.independentCensusVerified !== true) deny();
    return result;
  };
  const stopOptions = {
    ...recovery.stopOptions,
    trustedControllerPublicKey: recovery.pinnedControllerPublicKey,
    trustedControllerKeyId: recovery.pinnedControllerKeyId,
    expectedChallengeNonce: recovery.expectedChallengeNonce,
    readIndependentDeathProof: async (scope) => {
      // Only separate, authenticated Cloudflare transport can return a
      // signed, fresh, scoped proof. The existing connector verifies Ed25519.
      const receipt = await recovery.readAuthenticatedReceipt(scope);
      if (receipt?.verifiedIndependentSource !== true ||
          receipt?.workerName !== WORKER ||
          receipt?.namespaceId !== NAMESPACE ||
          receipt?.controllerRunId !== recovery.controllerRunId ||
          !receipt?.envelope) deny();
      return receipt.envelope;
    }
  };
  const detached = create020705ExistingWatchdogEntrypoint({
    scope: recovery.scope,
    controllerRunId: recovery.controllerRunId,
    readControllerCapabilities,
    stopOptions
  });
  let started = false;
  return Object.freeze({
    async runOnce() {
      if (started) deny();
      started = true;
      return owner.run();
    },
    async recoverOnce() {
      return detached.recover();
    }
  });
}
