// NOVELIGHT AI 02-07-05 detached failure-recovery composition.
// OFFLINE SYNTHETIC CONTRACT ONLY. This file does not create a supervisor,
// construct clients, read secrets, schedule work, or invoke any real service.
// Real kill, session revocation, cleanup and durable claim remain NO-GO.
import { verify020705SignedRunnerDeath } from './signed-runner-death-offline.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGE = 'wmlzjgvxgoyrovdhbqbg';
const COUNTS = [
  'users', 'identities', 'sessions', 'profiles',
  'novels', 'episodes', 'facts', 'analysis',
  'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit'
];
const SHA = /^[0-9a-f]{40}$/u;
const PREVIEW = /^dpl_[A-Za-z0-9]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function deny() {
  throw new Error('AI_020705_DETACHED_RECOVERY_OFFLINE_DENIED');
}

// prettier-ignore
function validScope(scope) {
  return scope?.repository === REPO &&
    scope?.stagingProjectRef === STAGE &&
    SHA.test(scope?.mainSha ?? '') &&
    PREVIEW.test(scope?.previewDeploymentId ?? '') &&
    UUID.test(scope?.actorId ?? '') &&
    ['runId', 'approvalCommentId', 'novelId', 'episodeId'].every((name) =>
      Number.isSafeInteger(scope[name]) && scope[name] > 0);
}

// prettier-ignore
function independentRunnerDeath(scope, proof, time) {
  if (!proof || typeof proof !== 'object' ||
      proof.kind !== 'detached-controller-runner-death' ||
      proof.repository !== scope.repository ||
      proof.stagingProjectRef !== scope.stagingProjectRef ||
      proof.mainSha !== scope.mainSha ||
      proof.previewDeploymentId !== scope.previewDeploymentId ||
      proof.actorId !== scope.actorId ||
      proof.novelId !== scope.novelId ||
      proof.episodeId !== scope.episodeId ||
      proof.runId !== scope.runId ||
      proof.approvalCommentId !== scope.approvalCommentId ||
      proof.runnerConfirmedDead !== true ||
      proof.controllerIsRunner !== false ||
      !Number.isSafeInteger(proof.controllerRunId) ||
      proof.controllerRunId < 1 ||
      proof.controllerRunId === scope.runId ||
      !Number.isFinite(proof.observedAtMs) ||
      !Number.isFinite(proof.runnerHeartbeatAtMs) ||
      !Number.isFinite(proof.expiresAtMs)) return false;
  return proof.expiresAtMs > time &&
    proof.expiresAtMs - time <= 30000 &&
    proof.observedAtMs <= time &&
    time - proof.observedAtMs <= 15000 &&
    proof.runnerHeartbeatAtMs <= proof.observedAtMs &&
    time - proof.runnerHeartbeatAtMs >= 250 &&
    time - proof.runnerHeartbeatAtMs <= 15000;
}

/**
 * The consumer and stop callbacks are SIMULATED adapters ONLY here.
 * A real external supervisor must authenticate proof provenance, own its
 * separate kill authority, atomically claim recovery in a durable ledger,
 * and prove zero residue independently. A caller-supplied boolean does not.
 */
export function create020705DetachedRecoveryOffline({
  mode,
  scope,
  readIndependentDeathProof,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  expectedChallengeNonce,
  claimRecoveryOnce,
  stopSyntheticModel,
  stopSyntheticRuntime,
  disableSyntheticPreview,
  revokeSyntheticSessions,
  cleanupSyntheticFixture,
  independentZeroCensus,
  now = Date.now
} = {}) {
  if (mode !== 'offline-synthetic-only' ||
      !validScope(scope) ||
      typeof now !== 'function' ||
      !trustedControllerPublicKey ||
      typeof trustedControllerKeyId !== 'string' ||
      typeof expectedChallengeNonce !== 'string' ||
      [readIndependentDeathProof, claimRecoveryOnce,
        stopSyntheticModel, stopSyntheticRuntime,
        disableSyntheticPreview, revokeSyntheticSessions,
        cleanupSyntheticFixture, independentZeroCensus].some((x) =>
        typeof x !== 'function')) deny();

  let attempted = false;
  const frozenScope = Object.freeze({...scope});
  return Object.freeze({
    async recover() {
      if (attempted) deny();
      attempted = true;
      // Recheck timestamps AFTER untrusted asynchronous observation.
      const started = now();
      let envelope;
      try {
        envelope = await readIndependentDeathProof(frozenScope);
      } catch {
        deny();
      }
      const observedAt = now();
      if (!Number.isFinite(started) || !Number.isFinite(observedAt) ||
          observedAt < started || observedAt - started > 15000 ||
          !verify020705SignedRunnerDeath({
            envelope, trustedControllerPublicKey,
            trustedControllerKeyId, expectedChallengeNonce
          }) ||
          !independentRunnerDeath(frozenScope, envelope.proof, observedAt)) deny();

      // The trusted consumer MUST durably enforce a unique conditional claim
      // across processes and runs. This module only checks its return value.
      const claim = Object.freeze({
        contract: 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1',
        ...frozenScope,
        controllerKeyId: trustedControllerKeyId,
        nonce: expectedChallengeNonce
      });
      let spent = false;
      try {
        spent = (await claimRecoveryOnce(claim)) === true;
      } catch {
        deny();
      }
      if (!spent) deny();
      const claimedAt = now();
      // A delayed claim cannot resurrect an expired report. Spent stays spent.
      if (!Number.isFinite(claimedAt) || claimedAt < observedAt ||
          claimedAt - observedAt > 15000 ||
          !independentRunnerDeath(frozenScope, envelope.proof, claimedAt)) deny();

      // Failures do NOT prevent other independent stop attempts.
      // Cleanup is unsafe until ALL stop/revoke stages succeed.
      let stopped = true;
      for (const operation of [
        stopSyntheticModel, stopSyntheticRuntime,
        disableSyntheticPreview, revokeSyntheticSessions
      ]) {
        try {
          if ((await operation(frozenScope)) !== true) stopped = false;
        } catch {
          stopped = false;
        }
      }
      let cleaned = false;
      if (stopped) {
        try {
          cleaned = (await cleanupSyntheticFixture(frozenScope)) === true;
        } catch {
          cleaned = false;
        }
      }

      // Always obtain a separate zero census, including on failure.
      let census;
      try {
        census = await independentZeroCensus(frozenScope);
      } catch {
        deny();
      }
      if (!stopped || !cleaned ||
          census?.runtimeDisabledZero !== true ||
          census?.approvalTombstoneCount !== 1 ||
          COUNTS.some((name) => census[name] !== 0)) deny();
      return Object.freeze({
        status: 'SYNTHETIC_RECOVERY_VERIFIED',
        authorizesRealMutation: false,
        authorizesPaidCall: false,
        noPaidRetry: true
      });
    }
  });
}
