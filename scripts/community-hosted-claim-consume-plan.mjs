// Pure one-use claim/consume marker planning and receipt inspection.
// Never posts comments, spends, provisions, authorizes or executes anything.
// Only a future trusted-main OWNER runner may authenticate facts, serialize
// claims, persist records and independently verify receipts.
import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED
} from './community-hosted-write-admission.mjs';
import {
  verifyCommunityHostedPreCostAdmission
} from './community-hosted-precost-admission.mjs';
import {
  inspectCommunityHostedLedgerTrail
} from './community-hosted-ledger-audit.mjs';

const SHA = /^[a-f0-9]{40}$/u;

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_CLAIM_PLAN_DENIED: ' + reason);
}

function blocked(status, fields) {
  return Object.freeze({
    status,
    ...fields,
    ownerAuthenticatedByThisModule: false,
    atomicClaimVerified: false,
    stagingCostApproved: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

function inspect(event, preparation, ledgerPages) {
  const state = inspectCommunityHostedLedgerTrail({
    event,
    preparation,
    ledgerPages
  });
  if (
    state.atomicClaimVerified !== false ||
    state.runAuthorized !== false ||
    state.stagingCostApproved !== false
  ) {
    deny('untrusted inspection attempted to grant authority');
  }
  return state;
}

// Creates the proposed immutable claim BODY only, never a live claim.
// The workflow must obtain fresh OWNER-authenticated evidence, a serialized
// claim lock and a new ledger read before even considering a POST.
export function prepareCommunityHostedClaimMarker({
  event,
  liveIssue,
  main,
  feature,
  compare,
  ledgerPages,
  runId
}) {
  const preparation = verifyCommunityHostedPreCostAdmission({
    event,
    liveIssue,
    main,
    feature,
    compare,
    ledgerPages,
    runId
  });
  const state = inspect(event, preparation, ledgerPages);
  if (state.status !== 'UNCLAIMED_RECORD_INSPECTION_ONLY') {
    deny('claim already exists or ledger state is not unclaimed');
  }
  const lastCommentId = ledgerPages.at(-1).at(-1)?.id;
  if (!Number.isSafeInteger(lastCommentId) || lastCommentId < 1) {
    deny('no observed ledger fence');
  }
  const body =
    HOSTED_CLAIMED +
    JSON.stringify({
      requestCommentId: preparation.requestCommentId,
      mainSha: preparation.mainSha,
      featureSha: preparation.candidateSha,
      runId: preparation.runId
    });
  return blocked('CLAIM_MARKER_PREPARATION_ONLY', {
    body,
    requestCommentId: preparation.requestCommentId,
    runId: preparation.runId,
    mainSha: preparation.mainSha,
    candidateSha: preparation.candidateSha,
    observedLastCommentId: String(lastCommentId),
    observationIsNotAtomic: true
  });
}

// A bot-authored claim record in a read-only snapshot is NOT an execution
// grant. The authorized live workflow and its concurrency/atomicity boundary
// are deliberately not implemented here.
export function inspectCommunityHostedClaimReceipt({
  event,
  preparation,
  ledgerPages
}) {
  const state = inspect(event, preparation, ledgerPages);
  if (
    state.status !== 'CLAIM_RECORD_INSPECTION_ONLY' ||
    state.claimCommentId === null
  ) {
    deny('exact one-use claim receipt is absent or already consumed');
  }
  return blocked('CLAIM_RECEIPT_INSPECTION_ONLY', {
    requestCommentId: state.requestCommentId,
    runId: state.runId,
    claimCommentId: state.claimCommentId
  });
}

// A terminal failure/cancellation record does not claim cleanup succeeded.
// A successful completion marker requires exact run-bound lifecycle evidence;
// the future live workflow must independently authenticate that evidence.
export function prepareCommunityHostedConsumeMarker({
  event,
  preparation,
  ledgerPages,
  outcome,
  lifecycleProof,
  freshMainSha,
  freshCandidateSha
}) {
  const state = inspect(event, preparation, ledgerPages);
  if (
    state.status !== 'CLAIM_RECORD_INSPECTION_ONLY' ||
    state.claimCommentId === null ||
    !['success', 'failure', 'cancelled'].includes(outcome) ||
    !SHA.test(freshMainSha ?? '') ||
    freshMainSha !== preparation.mainSha ||
    freshCandidateSha !== preparation.candidateSha
  ) {
    deny('no single live claim or fresh exact revision evidence');
  }
  if (
    outcome === 'success' &&
    (lifecycleProof?.status !== 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED' ||
      lifecycleProof.browserVerified !== true ||
      lifecycleProof.cleanupVerified !== true ||
      lifecycleProof.mainSha !== preparation.mainSha ||
      lifecycleProof.candidateSha !== preparation.candidateSha ||
      lifecycleProof.requestCommentId !== preparation.requestCommentId ||
      lifecycleProof.runId !== preparation.runId)
  ) {
    deny('successful completion lacks exact run-bound cleanup proof');
  }
  const body =
    HOSTED_CONSUMED +
    JSON.stringify({
      requestCommentId: preparation.requestCommentId,
      mainSha: preparation.mainSha,
      featureSha: preparation.candidateSha,
      runId: preparation.runId,
      result: outcome
    });
  return blocked('CONSUME_MARKER_PREPARATION_ONLY', {
    body,
    requestCommentId: preparation.requestCommentId,
    runId: preparation.runId,
    claimCommentId: state.claimCommentId,
    outcome,
    cleanupVerifiedByThisModule: false
  });
}

export function inspectCommunityHostedConsumeReceipt({
  event,
  preparation,
  ledgerPages,
  expectedOutcome
}) {
  const state = inspect(event, preparation, ledgerPages);
  if (
    state.status !== 'CONSUMED_RECORD_INSPECTION_ONLY' ||
    state.consumeCommentId === null ||
    state.terminalResult !== expectedOutcome
  ) {
    deny('terminal consumption receipt absent or unexpected');
  }
  return blocked('CONSUME_RECEIPT_INSPECTION_ONLY', {
    requestCommentId: state.requestCommentId,
    runId: state.runId,
    claimCommentId: state.claimCommentId,
    consumeCommentId: state.consumeCommentId,
    terminalResult: state.terminalResult
  });
}
