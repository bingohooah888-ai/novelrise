// NOVELIGHT AI 02-07-05 — dormant, GitHub-only dual-source receipt.
// Authenticated GET-only readers; no Staging, heartbeat, paid or mutation path.
import { read020705OwnerLedgerFromGithub } from './github-owner-ledger-readonly-reader.mjs';
import { read020705GithubRunnerExit } from './github-runner-exit-readonly.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PATH = '.github/workflows/ai-020705-owner-staging-paid-trial.yml';
const MAX_GAP_MS = 30000;

function deny() {
  throw new Error('AI_020705_GITHUB_DUAL_PROOF_DENIED');
}

/**
 * One read-only GitHub comparison, using two separately restricted tokens.
 * No default token or workflow wiring. This cannot attest an independently
 * running watchdog, a live synthetic trial, paid requests or Staging cleanup.
 */
export async function inspect020705GithubDualProof({
  scope,
  issuesReadToken,
  actionsReadToken,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (scope?.repository !== REPO ||
      scope?.issueNumber !== 294 ||
      !Number.isSafeInteger(scope?.runId) || scope.runId < 1 ||
      typeof issuesReadToken !== 'string' || issuesReadToken.length < 12 ||
      typeof actionsReadToken !== 'string' || actionsReadToken.length < 12 ||
      typeof fetchImpl !== 'function' || typeof now !== 'function') deny();

  const started = now();
  if (!Number.isFinite(started)) deny();

  try {
    const ledger = await read020705OwnerLedgerFromGithub({
      token: issuesReadToken, scope, fetchImpl, now
    });
    const runner = await read020705GithubRunnerExit({
      token: actionsReadToken,
      scope: {
        repository: REPO,
        workflowPath: PATH,
        runId: scope.runId,
        mainSha: scope.mainSha
      },
      fetchImpl,
      now
    });
    const ended = now();
    if (!Number.isFinite(ended) || ended < started ||
        ended - started > MAX_GAP_MS ||
        ledger.approvalCommentId !== scope.approvalCommentId ||
        ledger.runId !== scope.runId ||
        ledger.mainSha !== scope.mainSha ||
        ledger.previewDeploymentId !== scope.previewDeploymentId ||
        runner.runId !== ledger.runId ||
        runner.mainSha !== ledger.mainSha ||
        runner.repository !== REPO ||
        runner.workflowPath !== PATH ||
        runner.runAttempt !== 1 ||
        Math.abs(ledger.observedAtMs - runner.observedAtMs) > MAX_GAP_MS ||
        ledger.noPaidRetry !== true ||
        ledger.authorizesPaidCall !== false ||
        runner.noPaidRetry !== true ||
        runner.authorizesPaidCall !== false ||
        runner.authorizesMutation !== false ||
        runner.independentHeartbeatVerified !== false ||
        runner.syntheticScopeVerified !== false ||
        runner.cleanupVerified !== false) deny();

    // These states are REPORTS, not an approval token or a recovery plan.
    // Even a GitHub CONSUMED + completed run cannot confirm provider spend,
    // independently observed heartbeat, Staging cleanup or zero census.
    let state;
    if (ledger.status === 'UNCLAIMED') {
      state = 'GITHUB_UNCLAIMED_NO_EXECUTION';
    } else if (runner.terminalRunnerExitVerified !== true) {
      if (runner.status === 'completed' || runner.conclusion != null) deny();
      state = ledger.status === 'CONSUMED'
        ? 'GITHUB_CONSUMED_RUN_STILL_ACTIVE_CONFLICT'
        : 'GITHUB_CLAIMED_RUN_NOT_TERMINAL';
    } else if (runner.status !== 'completed' || runner.conclusion == null) {
      deny();
    } else if (ledger.status === 'CLAIMED') {
      state = 'GITHUB_TERMINAL_CLAIMED_NEEDS_INDEPENDENT_EVIDENCE';
    } else if (ledger.status === 'CONSUMED') {
      state = 'GITHUB_TERMINAL_CONSUMED_NEEDS_ZERO_CENSUS';
    } else {
      deny();
    }

    return Object.freeze({
      state,
      ledgerState: ledger.status,
      githubRunStatus: runner.status,
      githubRunConclusion: runner.conclusion,
      runId: scope.runId,
      mainSha: scope.mainSha,
      observedAtMs: ended,
      independentHeartbeatVerified: false,
      stagingCensusVerified: false,
      paidProviderAttemptVerified: false,
      authorizesMutation: false,
      authorizesPaidCall: false,
      noPaidRetry: true,
      proposedActions: Object.freeze([])
    });
  } catch {
    // Hide raw REST responses, tokens, and business identifiers from errors.
    deny();
  }
}
