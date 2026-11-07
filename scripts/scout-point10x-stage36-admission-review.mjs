// NOVELIGHT Point10x Phase 3.6: trusted-main admission REVIEW only.
// Imports existing immutable scope/SQL guard. No workflows, secrets, network,
// database calls, writer controls, CAS writes, or live execution on any path.
import { createHash } from 'node:crypto';
import {
  CUTOVER_SCOPE,
  SOURCE_SQL_SHA256,
  STAGING_REF,
  PRODUCTION_REF,
  compilePinnedCutoverReview
} from './scout-point10x-staging-cutover-adapter.mjs';
import {
  GITHUB_OWNER_ID,
  GITHUB_OWNER_LOGIN,
  GITHUB_REPO,
  ISSUE_NUMBER
} from './scout-point10x-owner-readonly-evidence.mjs';

export const NEW_OWNER_MARKER = 'NOVELIGHT_POINT10X_STAGING_CUTOVER_V1';
export const PROPOSED_LEDGER_REF =
  'refs/heads/novelight-point10x-single-use-ledger';
export const STAGING_LIVE_ENABLED = false;
const OWNER_FIELDS = Object.freeze(
  [
    'expiresAt',
    'issueNumber',
    'mainSha',
    'ownerId',
    'repo',
    'runCount',
    'scope',
    'sqlSha256',
    'stagingRef'
  ].sort()
);
const hex = (value, digits) =>
  typeof value === 'string' &&
  new RegExp('^[a-f0-9]{' + digits + '}$', 'u').test(value);
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, keys) =>
  record(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const reject = (reason) => {
  throw new Error('POINT10X_STAGE36_HOLD:' + reason);
};
const canonical = (value) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, value[k]])
    )
  );

export function parseNewScopeOwnerBody(body) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(NEW_OWNER_MARKER + '\n')
  )
    reject('NEW_SCOPE_MARKER_REQUIRED');
  const payload = body.slice(NEW_OWNER_MARKER.length + 1);
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    reject('INVALID_OWNER_JSON');
  }
  if (!sameKeys(value, OWNER_FIELDS) || canonical(value) !== payload)
    reject('OWNER_CANONICAL_SCHEMA');
  if (
    value.issueNumber !== ISSUE_NUMBER ||
    value.ownerId !== GITHUB_OWNER_ID ||
    value.repo !== GITHUB_REPO ||
    value.scope !== CUTOVER_SCOPE ||
    value.stagingRef !== STAGING_REF ||
    value.stagingRef === PRODUCTION_REF ||
    value.sqlSha256 !== SOURCE_SQL_SHA256 ||
    value.runCount !== 1 ||
    !hex(value.mainSha, 40)
  )
    reject('OWNER_SCOPE_OR_SQL_DRIFT');
  return Object.freeze(value);
}

// Inputs MUST come from a future trusted-main GitHub-hosted REST reader.
// This shape validator never proves REST provenance or enables Staging.
// The prior V3 read-only OWNER comment intentionally cannot pass.
export function inspectNewOwnerGitHubFacts(facts) {
  const {
    repo,
    issue,
    comment,
    trigger,
    mainRef,
    mainRefAfter,
    allCommentIds,
    now
  } = facts ?? {};
  if (
    !record(repo) ||
    repo.full_name !== GITHUB_REPO ||
    repo.owner?.id !== GITHUB_OWNER_ID ||
    repo.owner?.login !== GITHUB_OWNER_LOGIN ||
    repo.default_branch !== 'main'
  )
    reject('GITHUB_REPOSITORY_MISMATCH');
  if (
    !record(issue) ||
    issue.number !== ISSUE_NUMBER ||
    issue.state !== 'open' ||
    issue.pull_request != null ||
    issue.repository_url !== 'https://api.github.com/repos/' + GITHUB_REPO ||
    !Number.isSafeInteger(issue.comments) ||
    issue.comments !== allCommentIds?.length
  )
    reject('OWNER_ISSUE_OR_HISTORY_MISMATCH');
  if (
    !record(comment) ||
    !Number.isSafeInteger(comment.id) ||
    comment.id <= 0 ||
    comment.user?.id !== GITHUB_OWNER_ID ||
    comment.user?.login !== GITHUB_OWNER_LOGIN ||
    comment.author_association !== 'OWNER' ||
    comment.created_at !== comment.updated_at ||
    comment.deleted_at != null ||
    comment.issue_url !==
      'https://api.github.com/repos/' + GITHUB_REPO + '/issues/' + ISSUE_NUMBER
  )
    reject('OWNER_COMMENT_MISMATCH');
  if (
    !Array.isArray(allCommentIds) ||
    allCommentIds.length === 0 ||
    allCommentIds.filter((id) => id === comment.id).length !== 1 ||
    allCommentIds.some(
      (id, i) =>
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        (i > 0 && id <= allCommentIds[i - 1])
    )
  )
    reject('OWNER_HISTORY_INCOMPLETE');
  if (
    !sameKeys(trigger, [
      'repository',
      'issueNumber',
      'commentId',
      'eventName',
      'action',
      'actorId',
      'actorLogin',
      'runAttempt',
      'workflowRef',
      'checkoutSha'
    ]) ||
    trigger.repository !== GITHUB_REPO ||
    trigger.issueNumber !== ISSUE_NUMBER ||
    trigger.commentId !== comment.id ||
    trigger.eventName !== 'issue_comment' ||
    trigger.action !== 'created' ||
    trigger.actorId !== GITHUB_OWNER_ID ||
    trigger.actorLogin !== GITHUB_OWNER_LOGIN ||
    trigger.runAttempt !== 1 ||
    trigger.workflowRef !==
      GITHUB_REPO +
        '/.github/workflows/scout-point10x-staging-cutover.yml@refs/heads/main' ||
    !hex(trigger.checkoutSha, 40)
  )
    reject('TRUSTED_MAIN_EVENT_NOT_PRESENT');
  if (
    mainRef?.ref !== 'refs/heads/main' ||
    mainRefAfter?.ref !== 'refs/heads/main' ||
    mainRef.object?.sha !== mainRefAfter.object?.sha ||
    !hex(mainRef.object?.sha, 40) ||
    mainRef.object.sha !== trigger.checkoutSha
  )
    reject('MAIN_DRIFT_OR_UNTRUSTED_SHA');
  const claim = parseNewScopeOwnerBody(comment.body);
  const observed = Date.parse(now);
  const created = Date.parse(comment.created_at);
  const expires = Date.parse(claim.expiresAt);
  if (
    ![observed, created, expires].every(Number.isFinite) ||
    observed < created ||
    observed - created > 15 * 60_000 ||
    expires <= observed ||
    expires > created + 20 * 60_000
  )
    reject('APPROVAL_STALE_OR_EXPIRED');
  if (claim.mainSha !== mainRef.object.sha) reject('OWNER_PINNED_MAIN_CHANGED');
  const sql = compilePinnedCutoverReview();
  if (sql.sqlSha256 !== claim.sqlSha256) reject('SQL_SOURCE_CHANGED');
  return Object.freeze({
    status: 'NO_GO_GITHUB_REST_SHAPE_ONLY',
    approvalDigest: sha256(comment.body),
    commentId: comment.id,
    mainSha: claim.mainSha,
    sqlSha256: claim.sqlSha256,
    stagingRef: STAGING_REF,
    realGitHubAuthenticated: false,
    spentConsumed: false,
    mayOpenDatabase: false
  });
}

// Optional future zero-new-CONTROL approach: use a guarded GitHub git ref
// updated by a non-forced fast-forward commit on an already provisioned,
// owner-approved protected ledger branch. This is only a CAS *proposal*;
// GitHub admin ref rewrites, deleted branches and absent ruleset remain blockers.
export function planGitHubNonforceLedgerSpend({ ownerReview, ledger } = {}) {
  if (
    ownerReview?.status !== 'NO_GO_GITHUB_REST_SHAPE_ONLY' ||
    ownerReview?.realGitHubAuthenticated !== false ||
    ownerReview?.spentConsumed !== false ||
    !Number.isSafeInteger(ownerReview.commentId) ||
    ownerReview.commentId <= 0 ||
    !hex(ownerReview.mainSha, 40) ||
    !hex(ownerReview.approvalDigest, 64) ||
    ownerReview.sqlSha256 !== SOURCE_SQL_SHA256 ||
    ownerReview.stagingRef !== STAGING_REF
  )
    reject('UNTRUSTED_CLAIM_FOR_LEDGER');
  if (
    !sameKeys(ledger, [
      'ref',
      'headSha',
      'completeHistoryVerified',
      'branchProtectionVerified',
      'spentCommentIds'
    ]) ||
    ledger.ref !== PROPOSED_LEDGER_REF ||
    !hex(ledger.headSha, 40) ||
    ledger.completeHistoryVerified !== true ||
    ledger.branchProtectionVerified !== true ||
    !Array.isArray(ledger.spentCommentIds) ||
    ledger.spentCommentIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ledger.spentCommentIds).size !== ledger.spentCommentIds.length
  )
    reject('LEDGER_ATTESTATION_MISSING');
  if (ledger.spentCommentIds.includes(ownerReview.commentId))
    reject('APPROVAL_ALREADY_SPENT');
  return Object.freeze({
    status: 'NO_GO_LEDGER_PROPOSAL_ONLY',
    ref: PROPOSED_LEDGER_REF,
    expectedParentSha: ledger.headSha,
    force: false,
    proposedSpentId: ownerReview.commentId,
    claimDigest: sha256(
      ownerReview.approvalDigest +
        ':' +
        ownerReview.commentId +
        ':' +
        ownerReview.mainSha +
        ':' +
        SOURCE_SQL_SHA256
    ),
    mustReReadAuthoritativeRefAfterUnknownAck: true,
    automaticRetryAllowed: false,
    actualCASAttempted: false,
    durableOneUseSpent: false,
    mayOpenDatabase: false
  });
}

// Future runner's COMMIT ACK unknown is not proof of failure or success.
// Even ACK success cannot release Writer fencing without independent checks.
export function decideRecoveryReview({
  outcome,
  primaryMarker,
  ledgerSpent,
  independentPostcheck
} = {}) {
  if (
    ![
      'before-commit-aborted',
      'commit-ack-unknown',
      'commit-ack-success'
    ].includes(outcome)
  )
    reject('OUTCOME_INVALID');
  if (outcome === 'commit-ack-unknown')
    return Object.freeze({
      status: 'HOLD_READ_PRIMARY_AND_LEDGER',
      retryAllowed: false,
      resumeWriters: false,
      requireIndependentPrimaryRead: true
    });
  if (outcome === 'before-commit-aborted')
    return Object.freeze({
      status: 'HOLD_VERIFY_ROLLBACK_AND_WRITER_FENCE',
      retryAllowed: false,
      resumeWriters: false,
      requireIndependentPrimaryRead: true
    });
  if (
    primaryMarker !== 'verified-singleton' ||
    ledgerSpent !== true ||
    independentPostcheck !== true
  )
    return Object.freeze({
      status: 'HOLD_POSTCOMMIT_EVIDENCE_INCOMPLETE',
      retryAllowed: false,
      resumeWriters: false,
      requireIndependentPrimaryRead: true
    });
  return Object.freeze({
    status: 'NO_GO_OFFLINE_REVIEW_ONLY',
    retryAllowed: false,
    resumeWriters: false,
    requireIndependentPrimaryRead: false,
    requiresSeparateVerifiedResume: true
  });
}

export async function executeTrustedStagingCutover() {
  reject('NO_LIVE_EXECUTION_OR_STAGING_APPROVAL');
}
