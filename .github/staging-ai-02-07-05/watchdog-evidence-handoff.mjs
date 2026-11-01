// AI 02-07-05 — dormant, purely offline multi-source watchdog handoff.
// This is NOT a credentialed reader, a runner, a scheduler, a watchdog,
// or an authority to execute recovery, Staging changes or paid AI.
import { inspect020705WatchdogAdmission } from './watchdog-admission-core.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const WORKFLOW = '.github/workflows/ai-020705-owner-staging-paid-trial.yml';
const TERMINAL = new Set([
  'success', 'failure', 'cancelled', 'timed_out', 'skipped'
]);
const WINDOW_MS = 30000;

function deny() {
  throw new Error('AI_020705_WATCHDOG_HANDOFF_DENIED');
}

function safe(status, advice = []) {
  return Object.freeze({
    status,
    noPaidRetry: true,
    authorizesPaidCall: false,
    authorizesMutation: false,
    requiresSeparateOwnerApproval: true,
    proposedActions: Object.freeze([...advice])
  });
}

/**
 * An independent protected controller would need to obtain and authenticate
 * all three input sources. This module cannot authenticate a JavaScript
 * object, source flag, transport or independent heartbeat on its own.
 * Returned results are non-executable advice ONLY.
 */
export function assess020705WatchdogHandoff({
  scope,
  ledgerSnapshot,
  stagingEvidence,
  githubRunnerEvidence,
  heartbeatEvidence,
  now = Date.now
} = {}) {
  if (typeof now !== 'function' ||
      scope?.repository !== REPO ||
      scope?.issueNumber !== 294 ||
      scope?.stagingProjectRef !== PROJECT ||
      !Number.isSafeInteger(scope?.runId) || scope.runId < 1 ||
      !githubRunnerEvidence || typeof githubRunnerEvidence !== 'object') deny();
  const current = now();
  if (!Number.isFinite(current) ||
      githubRunnerEvidence.repository !== REPO ||
      githubRunnerEvidence.runId !== scope.runId ||
      githubRunnerEvidence.mainSha !== scope.mainSha ||
      githubRunnerEvidence.workflowPath !== WORKFLOW ||
      githubRunnerEvidence.runAttempt !== 1 ||
      !Number.isSafeInteger(githubRunnerEvidence.jobCount) ||
      githubRunnerEvidence.jobCount < 1 ||
      !Number.isFinite(githubRunnerEvidence.observedAtMs) ||
      githubRunnerEvidence.observedAtMs > current ||
      current - githubRunnerEvidence.observedAtMs > 300000 ||
      githubRunnerEvidence.noPaidRetry !== true ||
      githubRunnerEvidence.authorizesPaidCall !== false ||
      githubRunnerEvidence.authorizesMutation !== false) deny();

  // A Github Actions result is never a heartbeat or proof of cleanup.
  if (githubRunnerEvidence.independentHeartbeatVerified !== false ||
      githubRunnerEvidence.syntheticScopeVerified !== false ||
      githubRunnerEvidence.cleanupVerified !== false) deny();

  if (githubRunnerEvidence.terminalRunnerExitVerified !== true) {
    if (githubRunnerEvidence.status === 'completed' ||
        githubRunnerEvidence.conclusion != null) deny();
    return safe('RUNNER_EXIT_NOT_VERIFIED');
  }
  if (githubRunnerEvidence.status !== 'completed' ||
      !TERMINAL.has(githubRunnerEvidence.conclusion)) deny();

  // Without independently observed heartbeat, terminal GitHub status
  // does NOT unlock orphan cleanup advice.
  if (!heartbeatEvidence) {
    return safe('INDEPENDENT_HEARTBEAT_MISSING');
  }
  if (heartbeatEvidence.kind !== 'independent-controller-heartbeat' ||
      heartbeatEvidence.repository !== REPO ||
      heartbeatEvidence.projectRef !== PROJECT ||
      heartbeatEvidence.runId !== scope.runId ||
      heartbeatEvidence.mainSha !== scope.mainSha ||
      heartbeatEvidence.previewDeploymentId !== scope.previewDeploymentId ||
      heartbeatEvidence.approvalCommentId !== scope.approvalCommentId ||
      heartbeatEvidence.actorId !== scope.actorId ||
      heartbeatEvidence.novelId !== scope.novelId ||
      heartbeatEvidence.episodeId !== scope.episodeId ||
      !Number.isSafeInteger(heartbeatEvidence.controllerRunId) ||
      heartbeatEvidence.controllerRunId < 1 ||
      heartbeatEvidence.controllerRunId === scope.runId ||
      !Number.isFinite(heartbeatEvidence.observedAtMs) ||
      !Number.isFinite(heartbeatEvidence.lastHeartbeatAtMs) ||
      heartbeatEvidence.observedAtMs > current ||
      heartbeatEvidence.lastHeartbeatAtMs > current ||
      heartbeatEvidence.lastHeartbeatAtMs >
        heartbeatEvidence.observedAtMs ||
      !Number.isFinite(ledgerSnapshot?.observedAtMs) ||
      !Number.isFinite(stagingEvidence?.observedAtMs) ||
      Math.abs(githubRunnerEvidence.observedAtMs -
        heartbeatEvidence.observedAtMs) > WINDOW_MS ||
      Math.abs(heartbeatEvidence.observedAtMs -
        ledgerSnapshot.observedAtMs) > WINDOW_MS ||
      Math.abs(heartbeatEvidence.observedAtMs -
        stagingEvidence.observedAtMs) > WINDOW_MS) deny();

  // The extra scope in the old watchdog module is constructed ONLY after
  // every field is independently matched, not from an arbitrary claimed
  // or consumed flag. There is still no mutation authority.
  let admission;
  try {
    admission = inspect020705WatchdogAdmission({
      scope,
      ledgerSnapshot,
      stagingEvidence,
      runnerEvidence: {
        repository: REPO,
        projectRef: PROJECT,
        mainSha: scope.mainSha,
        previewDeploymentId: scope.previewDeploymentId,
        approvalCommentId: scope.approvalCommentId,
        runId: scope.runId,
        actorId: scope.actorId,
        novelId: scope.novelId,
        episodeId: scope.episodeId,
        readOnlySnapshotVerified: true,
        runAttempt: 1,
        observedAtMs: githubRunnerEvidence.observedAtMs,
        lastHeartbeatAtMs: heartbeatEvidence.lastHeartbeatAtMs,
        status: githubRunnerEvidence.status,
        conclusion: githubRunnerEvidence.conclusion
      },
      now: () => current
    });
  } catch {
    deny();
  }

  if (admission.authorizesMutation !== false ||
      admission.authorizesPaidCall !== false ||
      admission.noPaidRetry !== true) deny();
  return safe(admission.watchdogState, admission.proposedActions);
}
