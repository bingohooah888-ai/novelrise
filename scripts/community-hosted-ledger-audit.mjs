// Pure audit of the OWNER pre-cost approval, one-use claim and terminal
// consumption trail. There is NO GitHub write, execution grant or adapter here.
// A future runner must independently fetch authenticated GitHub evidence and
// enforce a serialized/atomic claim before it may spend or provision anything.
import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from './community-hosted-write-admission.mjs';
import { HOSTED_PRE_COST_APPROVE } from './community-hosted-precost-admission.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const CONTROL = '[Staging Approval Control] Preview / Staging cost gate';
const SHA = /^[0-9a-f]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_LEDGER_AUDIT_DENIED: ' + reason);
}

function parse(body, prefix, keys) {
  if (typeof body !== 'string' || body.length > 2048 || !body.startsWith(prefix)) {
    deny('invalid ledger marker');
  }
  let value;
  try {
    value = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid ledger JSON');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) {
    deny('ledger fields missing or injected');
  }
  return value;
}

function checkPages(pages) {
  if (
    !Array.isArray(pages) ||
    pages.length < 1 ||
    pages.length > 20 ||
    pages.some((page) => !Array.isArray(page) || page.length > 100) ||
    pages.slice(0, -1).some((page) => page.length !== 100) ||
    pages.at(-1).length === 100
  ) {
    deny('ledger pagination incomplete or ambiguous');
  }
  let previous = 0;
  for (const entry of pages.flat()) {
    if (
      !Number.isSafeInteger(entry?.id) ||
      entry.id <= previous ||
      typeof entry.body !== 'string'
    ) {
      deny('ledger identity, order or body invalid');
    }
    previous = entry.id;
  }
}

function requestAndPreparation(event, preparation) {
  if (
    event?.action !== 'created' ||
    event.repository?.full_name !== REPO ||
    event.issue?.number !== 188 ||
    event.issue?.title !== CONTROL ||
    event.issue?.pull_request ||
    event.issue?.user?.login !== OWNER ||
    event.comment?.user?.login !== OWNER ||
    event.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event.comment?.id) ||
    event.comment.id <= 0 ||
    preparation?.status !== 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY' ||
    preparation.liveEvidenceVerified !== false ||
    preparation.stagingCostApproved !== false ||
    preparation.runAuthorized !== false ||
    preparation.requestCommentId !== String(event.comment.id) ||
    !ID.test(preparation.runId) ||
    !SHA.test(preparation.mainSha) ||
    !SHA.test(preparation.candidateSha ?? '') ||
    preparation.candidateSha === preparation.mainSha
  ) {
    deny('OWNER request or independent preparation mismatched');
  }
  const request = parse(event.comment.body, HOSTED_PRE_COST_APPROVE, [
    'confirmation',
    'featureSha',
    'mainSha',
    'scope',
    'target'
  ]);
  if (
    request.scope !== HOSTED_SCOPE ||
    request.confirmation !== 'STAGING COST APPROVED' ||
    request.target !== 'new-data-less-isolated-branch' ||
    request.mainSha !== preparation.mainSha ||
    request.featureSha !== preparation.candidateSha
  ) {
    deny('proposal not bound to exact immutable scope');
  }
}

function inspectTransition(entry, prefix, preparation, requestId) {
  if (entry.user?.login !== 'github-actions[bot]') {
    deny('ledger transition is not authored by trusted runner');
  }
  const row = parse(
    entry.body,
    prefix,
    prefix === HOSTED_CLAIMED
      ? ['requestCommentId', 'mainSha', 'featureSha', 'runId']
      : ['requestCommentId', 'mainSha', 'featureSha', 'runId', 'result']
  );
  if (
    !ID.test(row.requestCommentId) ||
    !ID.test(row.runId) ||
    !SHA.test(row.mainSha) ||
    !SHA.test(row.featureSha) ||
    (prefix === HOSTED_CONSUMED &&
      !['success', 'failure', 'cancelled'].includes(row.result))
  ) {
    deny('invalid claim or consumed record');
  }
  const sameRequest = row.requestCommentId === requestId;
  const sameRun = row.runId === preparation.runId;
  if (sameRequest !== sameRun) {
    deny('request ID or run ID reused across executions');
  }
  if (
    sameRequest &&
    (row.mainSha !== preparation.mainSha ||
      row.featureSha !== preparation.candidateSha)
  ) {
    deny('transition does not bind the approved revision');
  }
  return sameRequest;
}

// Observes recorded transitions only. It NEVER issues a claim, checks
// atomicity, authorizes expenditure, proves billing approval or runs a test.
export function inspectCommunityHostedLedgerTrail({
  event,
  preparation,
  ledgerPages
}) {
  requestAndPreparation(event, preparation);
  checkPages(ledgerPages);
  const requestId = preparation.requestCommentId;
  let requestCount = 0;
  let claimId = null;
  let consumedId = null;
  let terminalResult = null;

  for (const entry of ledgerPages.flat()) {
    if (entry.id === event.comment.id) {
      if (
        entry.body !== event.comment.body ||
        entry.user?.login !== OWNER ||
        entry.author_association !== 'OWNER'
      ) {
        deny('source OWNER comment not present in ledger');
      }
      requestCount += 1;
    }
    const prefix = entry.body.startsWith(HOSTED_CLAIMED)
      ? HOSTED_CLAIMED
      : entry.body.startsWith(HOSTED_CONSUMED)
        ? HOSTED_CONSUMED
        : null;
    if (!prefix) continue;
    if (!inspectTransition(entry, prefix, preparation, requestId)) continue;
    if (entry.id <= event.comment.id || requestCount !== 1) {
      deny('transition predates the OWNER request');
    }
    if (prefix === HOSTED_CLAIMED) {
      if (claimId !== null || consumedId !== null) {
        deny('duplicate or out-of-order one-use claim');
      }
      claimId = entry.id;
    } else {
      if (claimId === null || consumedId !== null) {
        deny('orphan or duplicate terminal consumption');
      }
      consumedId = entry.id;
      terminalResult = parse(entry.body, prefix, [
        'requestCommentId',
        'mainSha',
        'featureSha',
        'runId',
        'result'
      ]).result;
    }
  }

  if (requestCount !== 1) deny('OWNER proposal absent from full ledger');
  const status = consumedId !== null
    ? 'CONSUMED_RECORD_INSPECTION_ONLY'
    : claimId !== null
      ? 'CLAIM_RECORD_INSPECTION_ONLY'
      : 'UNCLAIMED_RECORD_INSPECTION_ONLY';
  return Object.freeze({
    status,
    requestCommentId: requestId,
    runId: preparation.runId,
    claimCommentId: claimId === null ? null : String(claimId),
    consumeCommentId: consumedId === null ? null : String(consumedId),
    terminalResult,
    atomicClaimVerified: false,
    ownerAuthenticatedByThisModule: false,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}
