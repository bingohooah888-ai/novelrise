// 02-07-05: dormant protected Staging executor composition.
// No CLI, workflow trigger, network client, credential, Preview or paid call.
// Only a separately approved protected workflow may supply real adapters.
import { coordinate020705ProtectedStagingTrial } from './approved-stage-coordinator.mjs';
import { matches020705WatchdogArm } from './independent-watchdog-arm.mjs';
import { create020705StagingCleanup } from './staging-synthetic-cleanup.mjs';
import { matchesPaidTrialOneShotGuardedProviderScope } from
  '../../api/_lib/ai/paid-trial-one-shot-provider.js';

const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING_URL = 'https://' + STAGING_REF + '.supabase.co';
const OWNER = 'bingohooah888-ai';
const SHA = /^[0-9a-f]{40}$/u;
const PREVIEW = /^dpl_[A-Za-z0-9]+$/u;
const READ_ONLY_PROOFS = [
  'verifyCurrentMain',
  'verifyProtectedRunner',
  'verifyApprovedPreview',
  'verifyAtomicMigration',
  'verifySyntheticConsent',
  'verifyProviderBillingLimit'
];

function deny() {
  throw new Error('AI_020705_PROTECTED_STAGE_DENIED');
}

// Each proof must be a trusted, independent READ-ONLY live observation.
// No arbitrary claim of "approved" in an env var can replace these checks.
// This module intentionally does not furnish the adapters or enable a trigger.
export function create020705ProtectedStageExecutor({
  context,
  expected,
  synthetic,
  serviceClient,
  authAdmin,
  guardedProvider,
  request,
  readComments,
  writeComment,
  disableTrialEnvironment,
  revokeSyntheticSessions,
  independentCensus,
  readIndependentWatchdogArm,
  proofs,
  now = Date.now
} = {}) {
  if (
    context?.repository !== 'bingohooah888-ai/novelrise' ||
    context?.githubActor !== OWNER ||
    context?.triggeringActor !== OWNER ||
    context?.protectedEnvironment !== 'staging' ||
    context?.trustedRef !== 'refs/heads/main' ||
    context?.vercelTarget !== 'preview' ||
    context?.projectRef !== STAGING_REF ||
    context?.supabaseUrl !== STAGING_URL ||
    !SHA.test(context?.mainSha ?? '') ||
    !PREVIEW.test(context?.previewDeploymentId ?? '') ||
    context?.mainSha !== expected?.mainSha ||
    context?.previewDeploymentId !== expected?.previewDeploymentId ||
    !Number.isSafeInteger(context?.runId) ||
    context.runId < 1 ||
    !Number.isSafeInteger(context?.approvalCommentId) ||
    context.approvalCommentId < 1 ||
    expected?.stagingProjectRef !== STAGING_REF ||
    expected?.provider !== 'openai' ||
    expected?.model !== 'gpt-5.6-luna' ||
    !Number.isSafeInteger(expected?.capMicros) ||
    expected.capMicros < 1 ||
    expected.capMicros > 10000000 ||
    expected?.actorId !== synthetic?.userId ||
    expected?.novelId !== synthetic?.novelId ||
    context.approvalCommentId !== synthetic?.approvalCommentId ||
    !Number.isSafeInteger(expected?.episodeId) ||
    expected.episodeId < 1 ||
    serviceClient?.supabaseUrl !== STAGING_URL ||
    !matchesPaidTrialOneShotGuardedProviderScope(guardedProvider, {
      approvalCommentId: context.approvalCommentId,
      actorId: expected.actorId,
      novelId: expected.novelId,
      episodeId: expected.episodeId,
      mainSha: expected.mainSha,
      previewDeploymentId: expected.previewDeploymentId,
      capMicros: expected.capMicros
    }) ||
    request?.model !== 'gpt-5.6-luna' ||
    typeof request?.system !== 'string' ||
    typeof request?.user !== 'string' ||
    request.user.length < 1 ||
    request.user.length > 36000 ||
    typeof readComments !== 'function' ||
    typeof writeComment !== 'function' ||
    typeof now !== 'function' ||
    typeof readIndependentWatchdogArm !== 'function' ||
    !proofs ||
    READ_ONLY_PROOFS.some((name) => typeof proofs[name] !== 'function')
  ) {
    deny();
  }

  // Constructor performs structural validation only; it cannot make I/O.
  // Cleanup adapter rechecks the synthetic user in Auth before deleting data.
  const callbacks = create020705StagingCleanup({
    serviceClient,
    authAdmin,
    synthetic,
    disableTrialEnvironment,
    revokeSyntheticSessions,
    independentCensus
  });
  let attempted = false;

  return Object.freeze({
    async run() {
      // In-process replay protection complements the GitHub and DB ledgers.
      if (attempted) deny();
      attempted = true;
      const proofScope = Object.freeze({
        repository: context.repository,
        runId: context.runId,
        approvalCommentId: context.approvalCommentId,
        mainSha: context.mainSha,
        previewDeploymentId: context.previewDeploymentId,
        stagingProjectRef: STAGING_REF,
        novelId: expected.novelId,
        episodeId: expected.episodeId,
        actorId: expected.actorId
      });
      // No GitHub CLAIM or Staging mutation until every distinct live
      // gate has been checked from the protected runner itself.
      for (const name of READ_ONLY_PROOFS) {
        let verified = false;
        try {
          verified = await proofs[name](proofScope);
        } catch {
          deny();
        }
        if (verified !== true) deny();
      }
      // A distinct external supervisor must be armed before OWNER CLAIM.
      // The injected observer's authenticity is NOT established here; the
      // future protected runner must authenticate its independent channel.
      let receipt;
      try {
        receipt = await readIndependentWatchdogArm(proofScope);
      } catch {
        deny();
      }
      if (!matches020705WatchdogArm({
        scope: proofScope, receipt, now
      })) deny();
      return coordinate020705ProtectedStagingTrial({
        readComments,
        writeComment,
        approvalCommentId: context.approvalCommentId,
        expected,
        runId: context.runId,
        now,
        guardedProvider,
        request,
        stop: callbacks.stop,
        cleanup: callbacks.cleanup,
        finalCensus: callbacks.finalCensus
      });
    }
  });
}
