// NOVELIGHT AI 02-07-05 Gate A: dormant one-use signed arm contract.
// No network, GitHub, Staging, Preview, credentials, or provider calls here.
// This does NOT run a Watchdog, enable a runner, or grant mutation authority.
// An approved external controller and a trusted DURABLE ATOMIC consumer
// are still required to verify independence and stop residual work.
import { verify020705SignedWatchdogArm } from './signed-watchdog-arm.mjs';

/**
 * consumeChallengeOnce MUST be trusted and atomic across ALL runners/processes.
 * It must durably bind the supplied exact scope, challenge and controller key;
 * a local Set, process variable, GitHub comment or caller-supplied boolean is
 * NOT an acceptable real implementation. Only offline mocks use a local Set.
 * Any attempted consume (even if the post-consume lease expires) is spent.
 * No caller may initiate a model call on a false result.
 */
export async function admit020705SignedWatchdogArmOnce({
  scope,
  envelope,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  expectedChallengeNonce,
  consumeChallengeOnce,
  now = Date.now
} = {}) {
  if (typeof now !== 'function' ||
      typeof consumeChallengeOnce !== 'function') return false;
  try {
    const before = now();
    const verifyAt = (timestamp) => verify020705SignedWatchdogArm({
      scope, envelope, trustedControllerPublicKey,
      trustedControllerKeyId, expectedChallengeNonce,
      now: () => timestamp
    });
    if (!Number.isFinite(before) || !verifyAt(before)) return false;
    const challenge = Object.freeze({
      contract: 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1',
      repository: scope.repository,
      stagingProjectRef: scope.stagingProjectRef,
      mainSha: scope.mainSha,
      previewDeploymentId: scope.previewDeploymentId,
      actorId: scope.actorId,
      novelId: scope.novelId,
      episodeId: scope.episodeId,
      runId: scope.runId,
      approvalCommentId: scope.approvalCommentId,
      controllerKeyId: trustedControllerKeyId,
      nonce: expectedChallengeNonce
    });
    // The consumer must do a durable unique conditional insert/claim.
    // Only an unambiguous boolean true is accepted.
    if ((await consumeChallengeOnce(challenge)) !== true) return false;
    const after = now();
    return Number.isFinite(after) && after >= before && verifyAt(after);
  } catch {
    // Fail closed without leaking nonce, signature, credentials or raw errors.
    return false;
  }
}
