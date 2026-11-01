// 02-07-05 — independent-controller dry-run composition.
// This is NOT a deployed watchdog, scheduler, kill switch or network client.
// A future detached trusted controller MUST authenticate each source and
// have separately approved stop permissions. No action is ever executed here.
import { assess020705WatchdogHandoff } from './watchdog-evidence-handoff.mjs';

function deny() {
  throw new Error('AI_020705_DETACHED_SUPERVISOR_DRYRUN_DENIED');
}

/**
 * All callback sources are supplied by a future external protected runner.
 * This module intentionally does not accept a write/delete/kill callback.
 * It can produce evidence-based advisory ONLY, never a recovery action.
 */
export async function inspect020705DetachedSupervisorOffline({
  scope,
  readOwnerLedger,
  readGithubRunner,
  readStagingCensus,
  readIndependentHeartbeat,
  now = Date.now
} = {}) {
  if (typeof now !== 'function' ||
      !scope || typeof scope !== 'object' ||
      typeof readOwnerLedger !== 'function' ||
      typeof readGithubRunner !== 'function' ||
      typeof readStagingCensus !== 'function' ||
      typeof readIndependentHeartbeat !== 'function') deny();
  const started = now();
  if (!Number.isFinite(started)) deny();
  let result;
  try {
    // Explicitly do not trust GitHub Actions as the heartbeat source.
    // Callback provenance must be externally reviewed before live use.
    const [ledgerSnapshot, githubRunnerEvidence,
      stagingEvidence, heartbeatEvidence] = await Promise.all([
      readOwnerLedger(Object.freeze({...scope})),
      readGithubRunner(Object.freeze({...scope})),
      readStagingCensus(Object.freeze({...scope})),
      readIndependentHeartbeat(Object.freeze({...scope}))
    ]);
    const ended = now();
    if (!Number.isFinite(ended) || ended < started ||
        ended - started > 30000) deny();
    result = assess020705WatchdogHandoff({
      scope, ledgerSnapshot, stagingEvidence,
      githubRunnerEvidence, heartbeatEvidence, now: () => ended
    });
    if (result.authorizesPaidCall !== false ||
        result.authorizesMutation !== false ||
        result.noPaidRetry !== true ||
        result.requiresSeparateOwnerApproval !== true) deny();
    return Object.freeze({
      state: result.status,
      proposedActions: result.proposedActions,
      checkedAtMs: ended,
      provenanceAuthenticated: false,
      separatelyDeployedWatchdogVerified: false,
      externalStopCapabilitiesVerified: false,
      authorizesExecution: false,
      authorizesMutation: false,
      authorizesPaidCall: false,
      noPaidRetry: true,
      requiresSeparateOwnerApproval: true
    });
  } catch {
    // No raw token, manuscript, consent, user ID or upstream error returned.
    deny();
  }
}
