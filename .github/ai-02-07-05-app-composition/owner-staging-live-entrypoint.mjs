// Minimal admission entry for a future OWNER-approved, trusted-main Runner.
// No CLI, workflow dispatch, environment access, or I/O at import time.
// Admission is an observation from the PROTECTED main job, never a PR claim.
import { create020705ProtectedLiveComposition } from './protected-live-composition.mjs';

const REPOSITORY = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const BRANCH = 'staging/ai-02-07-05-live-20261114';
const PREVIEW = 'dpl_HscqVwRoSCxBAt9C3LHLof5971L9';
const PREVIEW_SHA = '05875d4f9c4a60e0caf980c6dcf1c85eb475196b';
const SHA = /^[0-9a-f]{40}$/u;
const positive = (x) => Number.isSafeInteger(x) && x > 0;
function deny() { throw new Error('AI_020705_OWNER_LIVE_ENTRY_DENIED'); }

// The trusted main job must independently read the GitHub run + environment
// reviewer evidence. The returned shape is NOT itself an authority grant;
// the existing executor independently verifies all six live proofs, OWNER
// ledger, signed Watchdog arm and atomic one-shot claim before any paid POST.
export function create020705OwnerStagingLiveEntrypoint({
  context, expected, readProtectedRunAdmission, live
} = {}) {
  if (
    context?.repository !== REPOSITORY ||
    context?.githubActor !== OWNER ||
    context?.triggeringActor !== OWNER ||
    context?.trustedRef !== 'refs/heads/main' ||
    context?.protectedEnvironment !== 'staging' ||
    context?.projectRef !== STAGING ||
    context?.supabaseUrl !== URL ||
    context?.vercelTarget !== 'preview' ||
    !SHA.test(context?.mainSha ?? '') ||
    context?.trustedSha !== context.mainSha ||
    context?.candidateSha !== PREVIEW_SHA ||
    context?.candidateCheckoutSha !== PREVIEW_SHA ||
    context?.stagingBranch !== BRANCH ||
    context?.previewDeploymentId !== PREVIEW ||
    !positive(context?.runId) ||
    !positive(context?.approvalCommentId) ||
    expected?.mainSha !== context.mainSha ||
    expected?.candidateSha !== PREVIEW_SHA ||
    expected?.stagingBranch !== BRANCH ||
    expected?.previewDeploymentId !== PREVIEW ||
    expected?.stagingProjectRef !== STAGING ||
    typeof readProtectedRunAdmission !== 'function' ||
    !live || typeof live !== 'object' || Array.isArray(live)
  ) deny();
  let attempted = false;
  return Object.freeze({
    async run() {
      if (attempted) deny();
      attempted = true;
      let proof;
      try {
        proof = await readProtectedRunAdmission(Object.freeze({
          repository: REPOSITORY, runId: context.runId,
          mainSha: context.mainSha, candidateSha: PREVIEW_SHA,
          stagingBranch: BRANCH, previewDeploymentId: PREVIEW
        }));
      } catch { deny(); }
      if (
        proof?.verifiedReadOnly !== true ||
        proof?.repository !== REPOSITORY ||
        proof?.runId !== context.runId ||
        proof?.ref !== 'refs/heads/main' ||
        proof?.sha !== context.mainSha ||
        proof?.actor !== OWNER || proof?.triggeringActor !== OWNER ||
        proof?.environment !== 'staging' ||
        proof?.environmentReviewerApproved !== true ||
        proof?.candidateCheckoutSha !== PREVIEW_SHA ||
        proof?.stagingBranch !== BRANCH ||
        proof?.previewDeploymentId !== PREVIEW
      ) deny();
      // This constructor checks the original scope; run() keeps all existing
      // independent evidence, stop, billing, cleanup and one-POST controls.
      return create020705ProtectedLiveComposition({
        ...live, context, expected
      }).run();
    }
  });
}
