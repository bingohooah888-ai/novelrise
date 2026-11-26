// 02-07-05 dormant protected Staging workflow coordinator.
// No network clients or secrets are constructed here. Requires separately
// admitted OWNER callbacks and a genuine DB-claimed one-shot model wrapper.
// The actual workflow does not invoke this without another approval/change.
import {
  claim020705OwnerApproval,
  consume020705OwnerApproval,
  verify020705ClaimedOwnerApproval
} from './owner-paid-trial-ledger.mjs';
import { run020705SinglePaidTrial } from './paid-trial-cleanup-runner.mjs';

export async function coordinate020705ProtectedStagingTrial({
  readComments,
  writeComment,
  approvalCommentId,
  expected,
  runId,
  now = Date.now,
  ownerLedgerAlreadyClaimed = false,
  guardedProvider,
  request,
  invokeModel,
  reviewResponse,
  stop,
  cleanup,
  finalCensus
} = {}) {
  // The comprehensive Runner claims before synthetic fixture creation
  // so independent recovery can act before paid admission.
  // Re-read the real ledger; a flag alone is never proof of a claim.
  const claimed = ownerLedgerAlreadyClaimed === true
    ? verify020705ClaimedOwnerApproval({
        comments: await readComments(),
        approvalCommentId,
        expected,
        runId,
        now: now()
      })
    : await claim020705OwnerApproval({
        readComments,
        writeComment,
        approvalCommentId,
        expected,
        runId,
        now
      });

  let result = 'failure';
  let outcome;
  let failed;
  try {
    outcome = await run020705SinglePaidTrial({
      claimed,
      guardedProvider,
      request,
      invokeModel,
      reviewResponse,
      stop,
      cleanup,
      finalCensus
    });
    result = 'success';
  } catch (error) {
    // Retain only a safe error code. Never leak manuscript, provider text,
    // secret, JWT or arbitrary thrown error into Actions or GitHub comments.
    failed =
      error?.message === 'AI_020705_PAID_CLEANUP_UNVERIFIED'
        ? 'AI_020705_PAID_CLEANUP_UNVERIFIED'
        : 'AI_020705_PAID_ATTEMPT_FAILED_NO_RETRY';
  } finally {
    // A consumed approval is never reusable, even if the model timed out,
    // the DB was unavailable or cleanup could not prove the zero census.
    // The encompassing Runner owns final consumption in preclaimed mode,
    // after its independent final census. Failure retains CLAIMED for
    // independent recovery and still cannot be retried.
    if (ownerLedgerAlreadyClaimed !== true) {
      await consume020705OwnerApproval({
        writeComment,
        approvalCommentId,
        runId,
        result
      });
    }
  }
  if (failed) throw new Error(failed);
  return outcome;
}
