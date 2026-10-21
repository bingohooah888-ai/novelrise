// One-use GitHub reservation and claim/consume receipt coordinator.
// NOT an executable workflow, credential provider, environment grant, or CLI.
// Callers must independently authenticate the OWNER event and the GitHub API,
// bind this to an audited trusted-main workflow, and serialize all writes.
// This module has no default network adapter and cannot activate Staging.
import {
  verifyCommunityHostedPreCostAdmission
} from './community-hosted-precost-admission.mjs';
import { inspectCommunityHostedReservationProtection } from './community-hosted-reservation-protection.mjs';
import {
  inspectCommunityHostedClaimReceipt,
  inspectCommunityHostedConsumeReceipt,
  prepareCommunityHostedClaimMarker,
  prepareCommunityHostedConsumeMarker
} from './community-hosted-claim-consume-plan.mjs';

const ISSUE_NUMBER = 188;
const REPO = 'bingohooah888-ai/novelrise';
const REF_PREFIX = 'refs/tags/novelight-community-hosted-once-v1-';
const SHA = /^[0-9a-f]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

function deny(message) {
  throw new Error('COMMUNITY_HOSTED_RESERVATION_DENIED: ' + message);
}

function requireAdapter(actions, names) {
  if (!actions || names.some((name) => typeof actions[name] !== 'function')) {
    deny('trusted GitHub read/write adapters unavailable');
  }
}

// Never forward adapter exceptions: they can contain response bodies or tokens.
async function safeCall(actions, name, argumentsObject) {
  try {
    return await actions[name](argumentsObject);
  } catch {
    deny(name + ' failed or outcome ambiguous; no automatic retry');
  }
}

function requireRunner({ repository, trustedMainSha, event, runId }) {
  if (
    repository !== REPO ||
    !SHA.test(trustedMainSha ?? '') ||
    !ID.test(String(runId ?? '')) ||
    !ID.test(String(event?.comment?.id ?? ''))
  ) {
    deny('invalid pinned trusted-main or request identity');
  }
  return REF_PREFIX + String(event.comment.id);
}

function requireAuthenticComment(sent, body, minimumId) {
  if (
    !Number.isSafeInteger(sent?.id) ||
    sent.id <= minimumId ||
    sent.body !== body ||
    sent.user?.login !== 'github-actions[bot]'
  ) {
    deny('comment creation receipt not authenticated');
  }
}

function inspectLivePreCost(snapshot, event, runId, trustedMainSha) {
  if (
    !snapshot ||
    snapshot.main?.object?.sha !== trustedMainSha
  ) {
    deny('main drift or incomplete live evidence');
  }
  return verifyCommunityHostedPreCostAdmission({
    event,
    liveIssue: snapshot.liveIssue,
    main: snapshot.main,
    feature: snapshot.feature,
    compare: snapshot.compare,
    ledgerPages: snapshot.ledgerPages,
    runId
  });
}

function stopped(fields) {
  return Object.freeze({
    ...fields,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false,
    mayDeployPreview: false,
    mayCreateBranch: false,
    mayRunBrowser: false
  });
}

// A separate OWNER pre-cost inspection is insufficient: the write adapter
// must independently re-fetch active GitHub tag ruleset evidence immediately
// before a reservation and again before posting its claim comment.
async function requireReservationTagProtection(actions, repository) {
  const evidence = await safeCall(actions, 'loadProtectionEvidence');
  const state = inspectCommunityHostedReservationProtection({
    repository,
    inventoryPages: evidence?.inventoryPages,
    tagRuleDetails: evidence?.tagRuleDetails
  });
  if (
    state.protectionObserved !== true ||
    state.stagingCostApproved !== false ||
    state.runAuthorized !== false ||
    state.writeAuthorized !== false
  ) {
    deny('reservation tag protection did not fail closed');
  }
}

// The GitHub create-ref endpoint is a unique-key reservation: creating the
// SAME ref a second time MUST fail. Keep refs permanently; never automatically
// delete/reforge them, including after a failed or ambiguous POST.
// Merely observing this ref is NOT proof of permission or authenticated cost
// approval. Production deployment and Staging execution are not supported.
export async function reserveAndRecordCommunityHostedClaim({
  repository,
  trustedMainSha,
  event,
  runId,
  actions
}) {
  const reservationRef = requireRunner({
    repository,
    trustedMainSha,
    event,
    runId
  });
  requireAdapter(actions, [
    'loadLiveSnapshot',
    'loadProtectionEvidence',
    'createUniqueRef',
    'readRef',
    'postIssueComment'
  ]);
  const initial = await safeCall(actions, 'loadLiveSnapshot');
  const preparation = inspectLivePreCost(
    initial,
    event,
    runId,
    trustedMainSha
  );
  const initialPlan = prepareCommunityHostedClaimMarker({
    event,
    liveIssue: initial.liveIssue,
    main: initial.main,
    feature: initial.feature,
    compare: initial.compare,
    ledgerPages: initial.ledgerPages,
    runId
  });

  await requireReservationTagProtection(actions, repository);

  // A single atomic Git ref creation reserves this APPROVAL NUMBER, not a
  // runner ID. An uncertain create outcome is NOT retried automatically.
  const created = await safeCall(actions, 'createUniqueRef', {
    repository,
    ref: reservationRef,
    sha: preparation.mainSha
  });
  if (
    created?.status !== 201 ||
    created.ref !== reservationRef ||
    created.sha !== preparation.mainSha
  ) {
    deny('unique reservation outcome is unconfirmed; do not retry');
  }
  const observed = await safeCall(actions, 'readRef', { repository, ref: reservationRef });
  if (
    observed?.status !== 200 ||
    observed.ref !== reservationRef ||
    observed.sha !== preparation.mainSha
  ) {
    deny('reserved exact Git ref cannot be confirmed');
  }

  // Refresh the complete ledger once again AFTER reserving and BEFORE posting.
  // A stale or consumed request stays reserved but never proceeds to costs.
  const beforeWrite = await safeCall(actions, 'loadLiveSnapshot');
  const renewedPlan = prepareCommunityHostedClaimMarker({
    event,
    liveIssue: beforeWrite.liveIssue,
    main: beforeWrite.main,
    feature: beforeWrite.feature,
    compare: beforeWrite.compare,
    ledgerPages: beforeWrite.ledgerPages,
    runId
  });
  if (
    beforeWrite.main?.object?.sha !== trustedMainSha ||
    renewedPlan.body !== initialPlan.body ||
    renewedPlan.requestCommentId !== preparation.requestCommentId
  ) {
    deny('claim data changed after reservation');
  }
  await requireReservationTagProtection(actions, repository);
  const sent = await safeCall(actions, 'postIssueComment', {
    repository,
    issueNumber: ISSUE_NUMBER,
    body: renewedPlan.body
  });
  requireAuthenticComment(
    sent,
    renewedPlan.body,
    Number(renewedPlan.observedLastCommentId)
  );

  const afterWrite = await safeCall(actions, 'loadLiveSnapshot');
  if (afterWrite.main?.object?.sha !== trustedMainSha) {
    deny('main moved while confirming claim receipt');
  }
  const receipt = inspectCommunityHostedClaimReceipt({
    event,
    preparation,
    ledgerPages: afterWrite.ledgerPages
  });
  if (receipt.claimCommentId !== String(sent.id)) {
    deny('new claim does not match the persisted GitHub comment');
  }
  return stopped({
    status: 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION',
    reservationRef,
    requestCommentId: preparation.requestCommentId,
    runId: preparation.runId,
    claimCommentId: receipt.claimCommentId,
    uniqueRefObserved: true,
    independentOwnerAuthorizationVerified: false,
    serializedWorkflowVerified: false,
    executableGrantIssued: false
  });
}

// Persist a terminal outcome ONLY for a visible matching claim. This module
// cannot independently authenticate the lifecycle proof or cleanup; a future
// trusted-main runner must check those facts independently before calling it.
// A failed/ambiguous POST must be manually reconciled, NOT retried.
export async function recordCommunityHostedConsumption({
  repository,
  trustedMainSha,
  event,
  preparation,
  outcome,
  lifecycleProof,
  actions
}) {
  const ref = requireRunner({
    repository,
    trustedMainSha,
    event,
    runId: preparation?.runId
  });
  requireAdapter(actions, [
    'loadLiveSnapshot',
    'loadProtectionEvidence',
    'readRef',
    'postIssueComment'
  ]);
  if (
    preparation?.mainSha !== trustedMainSha ||
    preparation?.requestCommentId !== String(event.comment.id)
  ) {
    deny('terminal identity mismatches the original approved request');
  }
  // The original immutable tag must remain protected even on a terminal
  // failure/cancellation path. A prior reservation is not enough.
  await requireReservationTagProtection(actions, repository);
  const reserved = await safeCall(actions, 'readRef', { repository, ref });
  if (
    reserved?.status !== 200 ||
    reserved.ref !== ref ||
    reserved.sha !== trustedMainSha
  ) {
    deny('terminal record lacks immutable reservation evidence');
  }
  const beforeWrite = await safeCall(actions, 'loadLiveSnapshot');
  const plan = prepareCommunityHostedConsumeMarker({
    event,
    preparation,
    ledgerPages: beforeWrite.ledgerPages,
    outcome,
    lifecycleProof,
    freshMainSha: beforeWrite.main?.object?.sha,
    freshCandidateSha: beforeWrite.feature?.head?.sha
  });
  // Re-check BOTH protection and the original ref immediately before a
  // terminal write. An ambiguous outcome must still never be replayed.
  await requireReservationTagProtection(actions, repository);
  const beforePostRef = await safeCall(actions, 'readRef', {
    repository,
    ref
  });
  if (
    beforePostRef?.status !== 200 ||
    beforePostRef.ref !== ref ||
    beforePostRef.sha !== trustedMainSha
  ) {
    deny('terminal reservation changed before final write');
  }
  const sent = await safeCall(actions, 'postIssueComment', {
    repository,
    issueNumber: ISSUE_NUMBER,
    body: plan.body
  });
  requireAuthenticComment(
    sent,
    plan.body,
    Number(beforeWrite.ledgerPages.at(-1).at(-1)?.id ?? 0)
  );
  const afterWrite = await safeCall(actions, 'loadLiveSnapshot');
  if (
    afterWrite.main?.object?.sha !== trustedMainSha ||
    afterWrite.feature?.head?.sha !== preparation.candidateSha
  ) {
    deny('terminal revision moved before persisted receipt confirmation');
  }
  const receipt = inspectCommunityHostedConsumeReceipt({
    event,
    preparation,
    ledgerPages: afterWrite.ledgerPages,
    expectedOutcome: outcome
  });
  if (receipt.consumeCommentId !== String(sent.id)) {
    deny('terminal record not present as exact GitHub receipt');
  }
  return stopped({
    status: 'CONSUMPTION_RECORDED_NO_RUN_AUTHORIZATION',
    reservationRef: ref,
    requestCommentId: preparation.requestCommentId,
    runId: preparation.runId,
    claimCommentId: receipt.claimCommentId,
    consumeCommentId: receipt.consumeCommentId,
    outcome,
    externalCleanupIndependentlyVerified: false,
    executableGrantIssued: false
  });
}
