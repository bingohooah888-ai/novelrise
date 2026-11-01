// 02-07-05 independent-watchdog evidence contract (OFFLINE ONLY).
// A future protected controller must authenticate provenance independently.
// This predicate neither operates a watchdog nor grants mutation authority.
const REPO = 'bingohooah888-ai/novelrise';
const STAGE = 'wmlzjgvxgoyrovdhbqbg';
const SHA = /^[a-f0-9]{40}$/u;
const PREVIEW = /^dpl_[a-z0-9]+$/iu;
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function matches020705WatchdogArm({scope, receipt, now = Date.now} = {}) {
  const time = typeof now === 'function' ? now() : NaN;
  if (!Number.isFinite(time) || scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGE ||
      !SHA.test(scope?.mainSha ?? '') ||
      !PREVIEW.test(scope?.previewDeploymentId ?? '') ||
      !UID.test(scope?.actorId ?? '') ||
      !Number.isSafeInteger(scope?.runId) || scope.runId < 1 ||
      !Number.isSafeInteger(scope?.approvalCommentId) || scope.approvalCommentId < 1 ||
      !Number.isSafeInteger(scope?.novelId) || scope.novelId < 1 ||
      !Number.isSafeInteger(scope?.episodeId) || scope.episodeId < 1) return false;
  return receipt?.kind === 'independent-controller-armed' &&
    receipt.repository === scope.repository &&
    receipt.stagingProjectRef === scope.stagingProjectRef &&
    receipt.mainSha === scope.mainSha &&
    receipt.previewDeploymentId === scope.previewDeploymentId &&
    receipt.actorId === scope.actorId &&
    receipt.runId === scope.runId &&
    receipt.approvalCommentId === scope.approvalCommentId &&
    receipt.novelId === scope.novelId &&
    receipt.episodeId === scope.episodeId &&
    receipt.protectedEnvironment === 'staging' &&
    receipt.controllerKind === 'external-independent-supervisor' &&
    Number.isSafeInteger(receipt.controllerRunId) &&
    receipt.controllerRunId > 0 &&
    receipt.controllerRunId !== scope.runId &&
    receipt.controllerIsRunner === false &&
    receipt.killAuthorityVerified === true &&
    receipt.stagingDisableVerified === true &&
    receipt.sessionRevocationVerified === true &&
    receipt.syntheticCleanupVerified === true &&
    receipt.zeroCensusVerified === true &&
    receipt.noPaidRetry === true &&
    Number.isFinite(receipt.observedAtMs) &&
    Number.isFinite(receipt.heartbeatAtMs) &&
    Number.isFinite(receipt.expiresAtMs) &&
    receipt.observedAtMs <= time &&
    receipt.heartbeatAtMs <= receipt.observedAtMs &&
    time - receipt.heartbeatAtMs <= 15000 &&
    time - receipt.observedAtMs <= 15000 &&
    receipt.expiresAtMs > time &&
    receipt.expiresAtMs - time <= 30000;
}
