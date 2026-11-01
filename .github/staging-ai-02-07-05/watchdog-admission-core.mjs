// AI 02-07-05: dormant, independently runnable watchdog ADMISSION only.
// This module does not schedule a job, call a network API, stop a runner,
// mutate Staging, claim approvals, or invoke an AI provider.
// Future independent protected infrastructure must authenticate observations.
import { audit020705RecoveryReadOnly } from './read-only-recovery-audit.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const MAX_OBSERVATION_SKEW_MS = 30000;
const MIN_STALE_HEARTBEAT_MS = 90000;
const TERMINAL = new Set([
  'success', 'failure', 'cancelled', 'timed_out', 'skipped'
]);
const RUNNING = new Set(['queued', 'in_progress']);

function deny() {
  throw new Error('AI_020705_WATCHDOG_ADMISSION_DENIED');
}

export function inspect020705WatchdogAdmission({
  scope,
  ledgerSnapshot,
  stagingEvidence,
  runnerEvidence,
  now = Date.now
} = {}) {
  if (typeof now !== 'function' || !scope ||
      scope.repository !== REPO ||
      scope.stagingProjectRef !== PROJECT ||
      !runnerEvidence || typeof runnerEvidence !== 'object') deny();

  const current = now();
  if (
    !Number.isFinite(current) ||
    runnerEvidence.repository !== REPO ||
    runnerEvidence.projectRef !== PROJECT ||
    runnerEvidence.mainSha !== scope.mainSha ||
    runnerEvidence.previewDeploymentId !== scope.previewDeploymentId ||
    runnerEvidence.approvalCommentId !== scope.approvalCommentId ||
    runnerEvidence.runId !== scope.runId ||
    runnerEvidence.actorId !== scope.actorId ||
    runnerEvidence.novelId !== scope.novelId ||
    runnerEvidence.episodeId !== scope.episodeId ||
    runnerEvidence.readOnlySnapshotVerified !== true ||
    runnerEvidence.runAttempt !== 1 ||
    !Number.isFinite(runnerEvidence.observedAtMs) ||
    runnerEvidence.observedAtMs > current ||
    current - runnerEvidence.observedAtMs > 300000 ||
    !Number.isFinite(stagingEvidence?.observedAtMs) ||
    Math.abs(runnerEvidence.observedAtMs - stagingEvidence.observedAtMs) >
      MAX_OBSERVATION_SKEW_MS ||
    !Number.isFinite(ledgerSnapshot?.observedAtMs) ||
    Math.abs(runnerEvidence.observedAtMs - ledgerSnapshot.observedAtMs) >
      MAX_OBSERVATION_SKEW_MS ||
    !Number.isFinite(runnerEvidence.lastHeartbeatAtMs) ||
    runnerEvidence.lastHeartbeatAtMs > current ||
    !RUNNING.has(runnerEvidence.status) &&
      runnerEvidence.status !== 'completed' ||
    (runnerEvidence.status === 'completed') !==
      TERMINAL.has(runnerEvidence.conclusion) ||
    (RUNNING.has(runnerEvidence.status) && runnerEvidence.conclusion != null)
  ) deny();

  // Revalidate the complete OWNER ledger and the exact Staging census.
  // Neither a runner's status nor a supplied claimed/consumed flag
  // can assert GitHub approval or authorize an external action.
  let audit;
  try {
    audit = audit020705RecoveryReadOnly({
      ledgerSnapshot, scope, stagingEvidence, now: () => current
    });
  } catch {
    deny();
  }

  const safe = (watchdogState, proposedActions = []) => Object.freeze({
    watchdogState,
    ledgerState: audit.ledgerState,
    recoveryState: audit.auditState,
    noPaidRetry: true,
    authorizesPaidCall: false,
    authorizesMutation: false,
    proposedActions: Object.freeze([...proposedActions])
  });

  if (audit.ledgerState === 'UNCLAIMED') {
    return safe('NO_APPROVED_ATTEMPT_TO_RECOVER');
  }
  if (audit.auditState === 'CONSUMED_AND_CLEANUP_VERIFIED') {
    return safe('CLEANUP_ALREADY_VERIFIED');
  }
  if (audit.ledgerState === 'CONSUMED') {
    // No second CONSUMED marker, even if residual synthetic rows remain.
    return safe('CONSUMED_RESIDUE_ADVISORY_ONLY', audit.proposedActions);
  }
  if (audit.ledgerState !== 'CLAIMED') deny();

  // A live or merely stale worker must never be stopped by inference.
  // Missing CONSUMED is not proof that the worker was killed.
  if (RUNNING.has(runnerEvidence.status)) {
    return safe(
      current - runnerEvidence.lastHeartbeatAtMs >= MIN_STALE_HEARTBEAT_MS
        ? 'STALE_WORKER_REQUIRES_INDEPENDENT_EXIT_PROOF'
        : 'WORKER_ACTIVE_NO_STOP'
    );
  }
  if (runnerEvidence.status !== 'completed' ||
      !TERMINAL.has(runnerEvidence.conclusion)) deny();

  // Even a completed Actions run does not grant cleanup authority; a
  // recent heartbeat requires another independent observation before
  // a separate OWNER-approved recovery controller can consider stopping.
  if (current - runnerEvidence.lastHeartbeatAtMs <
      MIN_STALE_HEARTBEAT_MS) {
    return safe('TERMINAL_WORKER_RECHECK_PENDING');
  }

  return safe('ORPHAN_RECOVERY_ADVISORY_ONLY', audit.proposedActions);
}
