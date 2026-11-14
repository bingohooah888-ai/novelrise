// 02-07-05: Staging-only independent STOP/CLEANUP connection.
// Intended for a DISTINCT, separately approved controller process; it
// cannot be run by the paid runner and does not schedule, deploy or arm itself.
// Existing signed death proof + existing cleanup adapter, not a new platform.
import { verify020705SignedRunnerDeath } from './signed-runner-death-offline.mjs';
import { create020705StagingCleanup } from './staging-synthetic-cleanup.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';

function deny() {
  throw new Error('AI_020705_DETACHED_STOP_DENIED');
}
const POSITIVE = (x) => Number.isSafeInteger(x) && x > 0;

export function create020705DetachedStopConnector({
  scope,
  synthetic,
  serviceClient,
  authAdmin,
  controllerRunId,
  readIndependentDeathProof,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  expectedChallengeNonce,
  claimRecoveryOnce,
  stopModelTransport,
  disableTrialEnvironment,
  revokeSyntheticSessions,
  independentCensus,
  now = Date.now
} = {}) {
  if (
    scope?.repository !== REPO ||
    scope?.stagingProjectRef !== STAGING ||
    !/^[a-f0-9]{40}$/u.test(scope?.mainSha ?? '') ||
    !/^dpl_[A-Za-z0-9]+$/u.test(scope?.previewDeploymentId ?? '') ||
    !POSITIVE(scope?.runId) ||
    !POSITIVE(scope?.approvalCommentId) ||
    !POSITIVE(scope?.novelId) ||
    !POSITIVE(scope?.episodeId) ||
    !POSITIVE(controllerRunId) ||
    controllerRunId === scope.runId ||
    synthetic?.verifiedSynthetic !== true ||
    synthetic?.projectRef !== STAGING ||
    synthetic?.supabaseUrl !== URL ||
    synthetic?.userId !== scope.actorId ||
    synthetic?.novelId !== scope.novelId ||
    synthetic?.approvalCommentId !== scope.approvalCommentId ||
    serviceClient?.supabaseUrl !== URL ||
    typeof readIndependentDeathProof !== 'function' ||
    typeof claimRecoveryOnce !== 'function' ||
    typeof stopModelTransport !== 'function' ||
    !trustedControllerPublicKey ||
    typeof trustedControllerKeyId !== 'string' ||
    typeof expectedChallengeNonce !== 'string' ||
    typeof now !== 'function'
  )
    deny();

  const cleanup = create020705StagingCleanup({
    serviceClient,
    authAdmin,
    synthetic,
    disableTrialEnvironment,
    revokeSyntheticSessions,
    independentCensus
  });
  let attempted = false;
  return Object.freeze({
    async recover() {
      if (attempted) deny();
      attempted = true;
      let envelope;
      try {
        envelope = await readIndependentDeathProof(Object.freeze({ ...scope }));
      } catch {
        deny();
      }
      if (
        !verify020705SignedRunnerDeath({
          envelope,
          trustedControllerPublicKey,
          trustedControllerKeyId,
          expectedChallengeNonce
        })
      )
        deny();
      const proof = envelope.proof;
      const time = now();
      const exact = [
        'repository',
        'stagingProjectRef',
        'mainSha',
        'previewDeploymentId',
        'actorId',
        'novelId',
        'episodeId',
        'runId',
        'approvalCommentId'
      ];
      if (
        !exact.every((key) => proof[key] === scope[key]) ||
        proof.kind !== 'detached-controller-runner-death' ||
        proof.runnerConfirmedDead !== true ||
        proof.controllerIsRunner !== false ||
        proof.controllerRunId !== controllerRunId ||
        !Number.isFinite(time) ||
        !Number.isFinite(proof.observedAtMs) ||
        !Number.isFinite(proof.runnerHeartbeatAtMs) ||
        !Number.isFinite(proof.expiresAtMs) ||
        proof.observedAtMs > time ||
        time - proof.observedAtMs > 15000 ||
        proof.runnerHeartbeatAtMs > proof.observedAtMs ||
        time - proof.runnerHeartbeatAtMs < 250 ||
        time - proof.runnerHeartbeatAtMs > 15000 ||
        proof.expiresAtMs <= time ||
        proof.expiresAtMs - time > 30000
      )
        deny();
      // This consumer MUST be durable and atomic across all processes.
      // The signed report and current-scope approval are NOT substitutes.
      const claim = Object.freeze({
        contract: 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1',
        ...scope,
        controllerKeyId: trustedControllerKeyId,
        nonce: expectedChallengeNonce
      });
      let claimed = false;
      try {
        claimed = (await claimRecoveryOnce(claim)) === true;
      } catch {
        deny();
      }
      if (!claimed) deny();
      let stopped = true;
      // Attempt BOTH transport kill and Staging shutdown on failures.
      try {
        if ((await stopModelTransport(scope)) !== true) stopped = false;
      } catch {
        stopped = false;
      }
      try {
        if ((await cleanup.stop()) !== true) stopped = false;
      } catch {
        stopped = false;
      }
      let cleared = false;
      if (stopped) {
        try {
          cleared = (await cleanup.cleanup()) === true;
        } catch {
          cleared = false;
        }
      }
      let census = false;
      try {
        census = (await cleanup.finalCensus()) === true;
      } catch {
        census = false;
      }
      if (!stopped || !cleared || !census) deny();
      return Object.freeze({
        status: 'INDEPENDENT_STAGING_STOP_AND_CLEANUP_VERIFIED',
        noPaidRetry: true
      });
    }
  });
}
