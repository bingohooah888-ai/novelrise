// 02-07-05 dormant protected Staging workflow coordinator.
// No network clients or secrets are constructed here. Requires separately
// admitted OWNER callbacks and a genuine DB-claimed one-shot model wrapper.
// The actual workflow does not invoke this without another approval/change.
import {
  claim020705OwnerApproval,
  consume020705OwnerApproval
} from './owner-paid-trial-ledger.mjs';
import { run020705SinglePaidTrial } from './paid-trial-cleanup-runner.mjs';

export async function coordinate020705ProtectedStagingTrial({
  readComments,
  writeComment,
  approvalCommentId,
  expected,
  runId,
  now,
  guardedProvider,
  request,
  stop,
  cleanup,
  finalCensus
} = {}) {
  const claimed = await claim020705OwnerApproval({
    readComments, writeComment, approvalCommentId, expected, runId, now
  });

  let result = 'failure';
  let outcome;
  let failed;
  try {
    outcome = await run020705SinglePaidTrial({
      claimed, guardedProvider, request, stop, cleanup, finalCensus
    });
    result = 'success';
  } catch (error) {
    // Retain only a safe error code. Never leak manuscript, provider text,
    // secret, JWT or arbitrary thrown error into Actions or GitHub comments.
    failed = error?.message === 'AI_020705_PAID_CLEANUP_UNVERIFIED'
      ? 'AI_020705_PAID_CLEANUP_UNVERIFIED'
      : 'AI_020705_PAID_ATTEMPT_FAILED_NO_RETRY';
  } finally {
    // A consumed approval is never reusable, even if the model timed out,
    // the DB was unavailable or cleanup could not prove the zero census.
    await consume020705OwnerApproval({
      writeComment, approvalCommentId, runId, result
    });
  }
  if (failed) throw new Error(failed);
  return outcome;
}
