// NOVELIGHT AI 02-07-05 Gate A — recovery lease PLAN, OFFLINE ONLY.
// Never starts a Watchdog, acquires a lease, performs recovery, uses network,
// loads credentials, touches Staging, or permits an additional paid AI POST.
// Caller-supplied snapshots are NOT authenticated by this module.
import { verify020705SignedRunnerDeath } from './signed-runner-death-offline.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGE = 'wmlzjgvxgoyrovdhbqbg';
const SHA = /^[0-9a-f]{40}$/u;
const PREVIEW = /^dpl_[A-Za-z0-9]+$/u;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const MAX_RECOVERY_ROUNDS = 3;
const MAX_OBSERVATION_AGE_MS = 15000;
const MAX_HEARTBEAT_AGE_MS = 15000;
const STEPS = Object.freeze([
  'FENCE_ALL_NEW_PAID_POSTS',
  'STOP_SYNTHETIC_MODEL_IF_POSSIBLE',
  'DISABLE_STAGING_RUNTIME_AND_ZERO_BUDGETS',
  'DISABLE_EXACT_APPROVED_PREVIEW',
  'REVOKE_EXACT_SYNTHETIC_SESSIONS',
  'CLEANUP_ONLY_VERIFIED_SYNTHETIC_FIXTURES',
  'READ_INDEPENDENT_ZERO_CENSUS'
]);

function deny() {
  throw new Error('AI_020705_RECOVERY_LEASE_OFFLINE_DENIED');
}

// prettier-ignore
function validScope(s) {
  return s?.repository === REPO &&
    s.stagingProjectRef === STAGE &&
    SHA.test(s.mainSha ?? '') &&
    PREVIEW.test(s.previewDeploymentId ?? '') &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(s.actorId ?? '') &&
    ['runId', 'approvalCommentId', 'novelId', 'episodeId'].every((key) =>
      Number.isSafeInteger(s[key]) && s[key] > 0);
}

// prettier-ignore
function matchingScope(a, b) {
  return a && b && [
    'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
    'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
  ].every((name) => a[name] === b[name]);
}

/**
 * A security-sensitive advisory. One-shot payment is NEVER retried.
 * The trusted ledger must atomically acquire a fenced, time-bounded lease
 * with a UNIQUE (approval + scope + round) key and a monotonically increasing
 * fence token. All real mutations must enforce that fence at their target.
 * No lease is acquired or authority returned by this function.
 */
export function plan020705BoundedRecoveryLeaseOffline({
  mode,
  scope,
  signedDeathEnvelope,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  expectedChallengeNonce,
  trustedLedgerSnapshot,
  nextRecoveryNonce,
  now = Date.now
} = {}) {
  if (mode !== 'offline-synthetic-only' || !validScope(scope) ||
      typeof now !== 'function' ||
      typeof trustedControllerKeyId !== 'string' ||
      !trustedControllerPublicKey ||
      !NONCE.test(expectedChallengeNonce ?? '') ||
      !NONCE.test(nextRecoveryNonce ?? '') ||
      expectedChallengeNonce === nextRecoveryNonce) deny();

  const time = now();
  const proof = signedDeathEnvelope?.proof;
  if (!Number.isFinite(time) ||
      !verify020705SignedRunnerDeath({
        envelope: signedDeathEnvelope, trustedControllerPublicKey,
        trustedControllerKeyId, expectedChallengeNonce
      }) ||
      !matchingScope(scope, proof) ||
      proof?.kind !== 'detached-controller-runner-death' ||
      proof.runnerConfirmedDead !== true ||
      proof.controllerIsRunner !== false ||
      !Number.isSafeInteger(proof.controllerRunId) ||
      proof.controllerRunId < 1 || proof.controllerRunId === scope.runId ||
      !Number.isFinite(proof.observedAtMs) ||
      !Number.isFinite(proof.runnerHeartbeatAtMs) ||
      !Number.isFinite(proof.expiresAtMs) ||
      proof.observedAtMs > time ||
      time - proof.observedAtMs > MAX_OBSERVATION_AGE_MS ||
      proof.runnerHeartbeatAtMs > proof.observedAtMs ||
      time - proof.runnerHeartbeatAtMs > MAX_HEARTBEAT_AGE_MS ||
      proof.expiresAtMs <= time ||
      proof.expiresAtMs - time > 30000) deny();

  const ledger = trustedLedgerSnapshot;
  if (!matchingScope(scope, ledger) ||
      ledger?.paidOneShotSpent !== true ||
      ledger.paidRetryCount !== 0 ||
      ledger.activeRecoveryLease !== false ||
      !Array.isArray(ledger.recoveryRounds) ||
      ledger.recoveryRounds.length > MAX_RECOVERY_ROUNDS ||
      !Number.isFinite(ledger.observedAtMs) ||
      ledger.observedAtMs > time ||
      time - ledger.observedAtMs > MAX_OBSERVATION_AGE_MS) deny();

  // A snapshot cannot itself prove durable claim or cross-host exclusivity.
  // Require a consecutive, fenced history; any uncertain state fails closed.
  let fence = 0;
  for (let i = 0; i < ledger.recoveryRounds.length; i++) {
    const round = ledger.recoveryRounds[i];
    if (!round || round.round !== i + 1 ||
        round.fence !== fence + 1 ||
        !['failed', 'complete'].includes(round.state) ||
        !NONCE.test(round.nonce ?? '') ||
        !Number.isFinite(round.finishedAtMs) ||
        round.finishedAtMs > time ||
        round.nonce === nextRecoveryNonce) deny();
    if (i > 0 && round.nonce === ledger.recoveryRounds[i - 1].nonce) deny();
    fence = round.fence;
    if (round.state === 'complete' && i !== ledger.recoveryRounds.length - 1) deny();
  }

  const last = ledger.recoveryRounds.at(-1);
  if (last?.state === 'complete') return Object.freeze({
    status: 'ALREADY_RECOVERED_ADVISORY',
    authorizesPaidCall: false, authorizesMutation: false,
    recoveryRound: null, requiresNewOwnerApprovalForLiveUse: true,
    proposedActions: Object.freeze([])
  });
  if (ledger.recoveryRounds.length >= MAX_RECOVERY_ROUNDS) deny();
  // This is an advisory only: no self-issued or caller-issued lease.
  return Object.freeze({
    status: 'BOUNDED_RECOVERY_LEASE_CANDIDATE_OFFLINE',
    recoveryRound: ledger.recoveryRounds.length + 1,
    expectedNextFence: fence + 1,
    requiredNewNonce: nextRecoveryNonce,
    maxRecoveryRounds: MAX_RECOVERY_ROUNDS,
    authorizesPaidCall: false,
    authorizesMutation: false,
    requiresNewOwnerApprovalForLiveUse: true,
    proposedActions: STEPS
  });
}
