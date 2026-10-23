// Offline contract for a FUTURE OWNER-led staging approval workflow.
// No network calls, side effects, secrets, GitHub comments, or DB access.
// Callers MUST independently authenticate and obtain live GitHub facts.
const SHA = /^[0-9a-f]{40}$/u;
const PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_CANDIDATE_APPROVE ';
const MARKERS = [
  'NOVELIGHT_STAGING_COMMUNITY_CLAIMED ',
  'NOVELIGHT_STAGING_COMMUNITY_CONSUMED '
];
const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE_TITLE = '[Staging Control] Supabase migration sync';
const MIGRATION = '20261014052000';
const SCOPE = 'community-phase1-isolated';

function refuse(message) {
  throw new Error('COMMUNITY_CANDIDATE_APPROVAL_BLOCKED: ' + message);
}

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function parseBoundedJson(raw, prefix, keys) {
  if (typeof raw !== 'string' || raw.length > 2048 ||
      !raw.startsWith(prefix)) {
    refuse('invalid OWNER approval command');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(prefix.length));
  } catch {
    refuse('invalid JSON');
  }
  if (!exactObject(parsed, keys)) refuse('unexpected approval fields');
  return parsed;
}

export function inspectCommunityCandidateApproval({
  repository,
  issue,
  comment,
  currentMainSha,
  pr,
  comparison,
  ledger,
  ledgerComplete
} = {}) {
  if (repository !== REPO) refuse('wrong repository');
  if (!issue || issue.number !== 294 || issue.title !== ISSUE_TITLE ||
      issue.pull_request || issue.user?.login !== OWNER) {
    refuse('not the approved Issue #294 control');
  }
  if (!comment || !Number.isSafeInteger(comment.id) || comment.id <= 0 ||
      comment.user?.login !== OWNER ||
      comment.author_association !== 'OWNER') {
    refuse('comment is not an authenticated OWNER request');
  }
  if (!SHA.test(currentMainSha ?? '') || !pr ||
      !SHA.test(pr.headSha ?? '') || !SHA.test(pr.baseSha ?? '') ||
      currentMainSha === pr.headSha) {
    refuse('invalid immutable commit identities');
  }
  if (pr.number !== 2222 || pr.state !== 'open' ||
      pr.draft !== true || pr.merged !== false ||
      pr.baseRef !== 'main' || pr.baseSha !== currentMainSha) {
    refuse('candidate PR has moved, merged, or changed base');
  }
  if (!comparison || comparison.baseSha !== currentMainSha ||
      comparison.headSha !== pr.headSha ||
      comparison.status !== 'ahead') {
    refuse('exact candidate ancestry has not been proved');
  }

  const req = parseBoundedJson(comment.body, PREFIX, [
    'scope', 'mainSha', 'candidateSha', 'migration', 'confirmation'
  ]);
  if (req.scope !== SCOPE || req.mainSha !== currentMainSha ||
      req.candidateSha !== pr.headSha ||
      req.migration !== MIGRATION ||
      req.confirmation !== 'STAGING APPROVED') {
    refuse('approval target or scope drift');
  }
  if (ledgerComplete !== true || !Array.isArray(ledger) ||
      ledger.length > 2000) {
    refuse('OWNER ledger is not fully observed');
  }
  for (const item of ledger) {
    if (!item || typeof item.body !== 'string') {
      refuse('invalid ledger entry');
    }
    const prefix = MARKERS.find((marker) => item.body.startsWith(marker));
    if (!prefix) continue;
    const row = parseBoundedJson(item.body, prefix, [
      'requestCommentId', 'candidateSha', 'scope'
    ]);
    if (String(row.requestCommentId) === String(comment.id)) {
      refuse('approval request already claimed or consumed');
    }
  }
  return Object.freeze({
    verdict: 'CONTRACT_MATCH_ONLY',
    prNumber: 2222,
    issueNumber: 294,
    mainSha: currentMainSha,
    candidateSha: pr.headSha,
    migrationVersion: MIGRATION,
    scope: SCOPE,
    requestCommentId: comment.id,
    previewPermitted: false,
    stagingMutationPermitted: false,
    ownerIdentityProvedByThisFunction: false,
    approvalConsumed: false,
    why: 'Offline match is not a host-authenticated OWNER approval or ' +
      'an installed default-branch Staging executor.'
  });
}

export const communityCandidateApprovalContract = Object.freeze({
  issueNumber: 294,
  prefix: PREFIX,
  migrationVersion: MIGRATION,
  scope: SCOPE,
  approvalPayloadKeys: Object.freeze([
    'scope', 'mainSha', 'candidateSha', 'migration', 'confirmation'
  ])
});
