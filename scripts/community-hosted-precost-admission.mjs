// Preparation-only OWNER pre-cost admission for Community Phase 1 hosted login.
// NO GitHub mutations, secrets, Supabase, Vercel, browser or execution grants.
// A future trusted-main workflow must independently fetch and verify evidence,
// atomically claim an approval BEFORE costs, and consume it after the run.
import { readFileSync } from 'node:fs';
import { assertReviewedCommunityCandidate } from './community-phase1-reviewed-candidate.mjs';

import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from './community-hosted-write-admission.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE = '[Staging Approval Control] Preview / Staging cost gate';
const SHA = /^[0-9a-f]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

// This is an independent proposal format, not a real execution approval.
// It deliberately needs no branch ref / Preview URL before paid provisioning.
export const HOSTED_PRE_COST_APPROVE =
  'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ';

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_PRE_COST_DENIED: ' + reason);
}

function record(body, prefix, fields) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(prefix)
  ) {
    deny('malformed control record');
  }
  let data;
  try {
    data = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid control JSON');
  }
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).sort().join(',') !== [...fields].sort().join(',')
  ) {
    deny('unexpected control fields');
  }
  return data;
}

function unusedLedger(ledgerPages, requestComment, runId) {
  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 20 ||
    !ledgerPages.every(
      (page) => Array.isArray(page) && page.length <= 100
    ) ||
    ledgerPages.slice(0, -1).some((page) => page.length !== 100) ||
    ledgerPages.at(-1).length === 100
  ) {
    deny('unverified or truncated approval ledger');
  }
  let priorId = 0;
  let requestSeen = 0;
  for (const entry of ledgerPages.flat()) {
    if (
      !Number.isSafeInteger(entry?.id) ||
      entry.id <= priorId ||
      typeof entry.body !== 'string'
    ) {
      deny('malformed or unordered ledger entry');
    }
    priorId = entry.id;
    if (entry.id === requestComment.id) {
      if (
        entry.body !== requestComment.body ||
        entry.user?.login !== OWNER ||
        entry.author_association !== 'OWNER'
      ) {
        deny('original OWNER request not authentic in ledger');
      }
      requestSeen += 1;
    }
    const prefix = entry.body.startsWith(HOSTED_CLAIMED)
      ? HOSTED_CLAIMED
      : entry.body.startsWith(HOSTED_CONSUMED)
        ? HOSTED_CONSUMED
        : null;
    if (!prefix) continue;
    const row = record(
      entry.body,
      prefix,
      prefix === HOSTED_CLAIMED
        ? ['requestCommentId', 'mainSha', 'featureSha', 'runId']
        : ['requestCommentId', 'mainSha', 'featureSha', 'runId', 'result']
    );
    if (
      !ID.test(String(row.requestCommentId)) ||
      !ID.test(String(row.runId)) ||
      !SHA.test(row.mainSha) ||
      !SHA.test(row.featureSha) ||
      (prefix === HOSTED_CONSUMED &&
        (typeof row.result !== 'string' || !row.result))
    ) {
      deny('invalid one-use ledger claim');
    }
    if (
      String(row.requestCommentId) === String(requestComment.id) ||
      String(row.runId) === String(runId)
    ) {
      deny('already claimed/consumed approval or runner');
    }
  }
  if (requestSeen !== 1) {
    deny('original OWNER request missing from complete ledger');
  }
}

export function verifyCommunityHostedPreCostAdmission({
  event,
  liveIssue,
  main,
  feature,
  compare,
  ledgerPages,
  runId
}) {
  if (
    event?.action !== 'created' ||
    event.repository?.full_name !== REPO ||
    event.issue?.number !== 188 ||
    event.issue?.state !== 'open' ||
    event.issue?.title !== ISSUE ||
    event.issue?.pull_request ||
    event.issue?.user?.login !== OWNER ||
    event.comment?.user?.login !== OWNER ||
    event.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event.comment?.id) ||
    event.comment.id <= 0 ||
    !ID.test(String(runId || ''))
  ) {
    deny('not an authentic owner-controlled single-run proposal');
  }
  if (
    !Number.isSafeInteger(event.issue.id) ||
    event.issue.id <= 0 ||
    liveIssue?.id !== event.issue.id ||
    liveIssue?.number !== 188 ||
    liveIssue?.state !== 'open' ||
    liveIssue?.url !== event.issue.url ||
    liveIssue.url !== `https://api.github.com/repos/${REPO}/issues/188` ||
    liveIssue.title !== ISSUE ||
    liveIssue.user?.login !== OWNER
  ) {
    deny('live approval issue is closed or does not match the event');
  }
  const proposal = record(event.comment.body, HOSTED_PRE_COST_APPROVE, [
    'confirmation',
    'featureSha',
    'mainSha',
    'scope',
    'target'
  ]);
  if (
    proposal.scope !== HOSTED_SCOPE ||
    proposal.confirmation !== 'STAGING COST APPROVED' ||
    proposal.target !== 'new-data-less-isolated-branch' ||
    !SHA.test(proposal.mainSha) ||
    proposal.mainSha !== main?.object?.sha ||
    !SHA.test(proposal.featureSha) ||
    proposal.featureSha === proposal.mainSha ||
    feature?.number !== 2222 ||
    feature.state !== 'open' ||
    feature.draft !== true ||
    feature.merged === true ||
    feature.base?.ref !== 'main' ||
    feature.base?.sha !== proposal.mainSha ||
    feature.head?.sha !== proposal.featureSha ||
    feature.head?.repo?.full_name !== REPO
  ) {
    deny('fresh main, immutable Draft feature or request scope mismatch');
  }
  try {
    assertReviewedCommunityCandidate({
      compare,
      mainSha: proposal.mainSha,
      candidateSha: proposal.featureSha
    });
  } catch {
    deny('unreviewed feature blobs or incomplete ancestry proof');
  }
  unusedLedger(ledgerPages, event.comment, runId);

  // Structural/synthetic evidence is NOT a permission to allocate resources.
  // A trusted-main runner must re-fetch live ledger and external resource
  // facts and perform a serialized claim before any paid action.
  return Object.freeze({
    status: 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY',
    mainSha: proposal.mainSha,
    candidateSha: proposal.featureSha,
    requestCommentId: String(event.comment.id),
    runId: String(runId),
    plannedBranchName: 'community-hosted-' + String(runId),
    liveEvidenceVerified: false,
    stagingCostApproved: false,
    mayClaim: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    runAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'validate') {
  try {
    const paths = process.argv.slice(3);
    if (paths.length !== 7) deny('six evidence files and run ID required');
    const [
      eventPath, issuePath, mainPath, featurePath,
      comparePath, ledgerPath, runId
    ] = paths;
    const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const verdict = verifyCommunityHostedPreCostAdmission({
      event: read(eventPath),
      liveIssue: read(issuePath),
      main: read(mainPath),
      feature: read(featurePath),
      compare: read(comparePath),
      ledgerPages: read(ledgerPath),
      runId
    });
    process.stdout.write(JSON.stringify(verdict) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
