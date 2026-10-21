// Connect existing hosted reservation, terminal receipt and isolated lifecycle
// adapters without providing authority. No CLI or event trigger is added.
// Watch registration uses only explicitly supplied protected-runner tokens;
// it cannot mint an execution grant or provision a billable resource.
// A separately audited trusted-main runner must independently supply OWNER,
// environment, budget and exclusivity evidence before calling the handoff.
import {
  recordCommunityHostedConsumption,
  reserveAndRecordCommunityHostedClaim
} from './community-hosted-reservation-coordinator.mjs';
import { runCommunityHostedWriteLifecycle } from './community-hosted-write-lifecycle.mjs';
import { registerCommunityWatchBeforeProvisioning } from './community-hosted-watchdog-registration.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const SHA = /^[0-9a-f]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

function deny() {
  // Suppress raw external responses, events and credentials.
  throw new Error('COMMUNITY_HOSTED_BINDINGS_DENIED');
}

export function makeCommunityHostedCoordinatorBindings({
  repository,
  trustedMainSha,
  event,
  preparation,
  githubActions,
  isolatedTarget,
  isolatedActions,
  watchdogCredentials,
  watchdogFetch = fetch
}) {
  if (
    repository !== REPO ||
    !SHA.test(trustedMainSha ?? '') ||
    event?.action !== 'created' ||
    event.repository?.full_name !== REPO ||
    !Number.isSafeInteger(event.comment?.id) ||
    event.comment.id <= 0 ||
    preparation?.status !== 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY' ||
    preparation.mainSha !== trustedMainSha ||
    !SHA.test(preparation.candidateSha ?? '') ||
    preparation.candidateSha === trustedMainSha ||
    preparation.requestCommentId !== String(event.comment.id) ||
    !ID.test(preparation.runId ?? '') ||
    preparation.stagingCostApproved !== false ||
    preparation.runAuthorized !== false ||
    !githubActions ||
    !isolatedTarget ||
    !isolatedActions
  ) {
    deny();
  }

  function verifyRun(run) {
    if (
      run?.repository !== repository ||
      run.mainSha !== trustedMainSha ||
      run.candidateSha !== preparation.candidateSha ||
      run.requestCommentId !== preparation.requestCommentId ||
      run.runId !== preparation.runId ||
      run.scope !== 'community-phase1-hosted-authenticated-write'
    ) {
      deny();
    }
  }

  return Object.freeze({
    // These adapters DO NOT form a full executable handoff:
    // independent verifyFreshProtectedBoundary and
    // obtainIndependentExecutionGrant are deliberately absent.
    reserveAndRecordClaim: async (run) => {
      verifyRun(run);
      return reserveAndRecordCommunityHostedClaim({
        repository,
        trustedMainSha,
        event,
        runId: preparation.runId,
        actions: githubActions
      });
    },
    // No synthetic live flag or fallback credential is accepted. The future
    // trusted-main runner supplies real credentials after independent grant.
    registerAndVerifyCleanupWatch: async (run, grant, claim) => {
      verifyRun(run);
      if (
        !watchdogCredentials ||
        typeof watchdogFetch !== 'function' ||
        ['signingKey', 'githubToken', 'supabaseToken'].some((key) =>
          typeof watchdogCredentials[key] !== 'string' ||
          watchdogCredentials[key].length < 32
        )
      ) {
        deny();
      }
      return registerCommunityWatchBeforeProvisioning({
        run,
        grant,
        claim,
        signingKey: watchdogCredentials.signingKey,
        githubToken: watchdogCredentials.githubToken,
        supabaseToken: watchdogCredentials.supabaseToken,
        fetchImpl: watchdogFetch
      });
    },
    runIsolatedLifecycle: async (run, grant) => {
      verifyRun(run);
      if (
        grant?.scope !== run.scope ||
        grant.mainSha !== run.mainSha ||
        grant.candidateSha !== run.candidateSha ||
        grant.requestCommentId !== run.requestCommentId ||
        grant.runId !== run.runId
      ) {
        deny();
      }
      return runCommunityHostedWriteLifecycle({
        grant,
        target: isolatedTarget,
        actions: isolatedActions
      });
    },
    recordTerminalConsumption: async ({
      run,
      claim,
      outcome,
      lifecycleProof
    }) => {
      verifyRun(run);
      if (
        claim?.requestCommentId !== run.requestCommentId ||
        claim.runId !== run.runId ||
        !['success', 'failure', 'cancelled'].includes(outcome)
      ) {
        deny();
      }
      return recordCommunityHostedConsumption({
        repository,
        trustedMainSha,
        event,
        preparation,
        outcome,
        lifecycleProof,
        actions: githubActions
      });
    }
  });
}
