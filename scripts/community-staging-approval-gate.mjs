// Trusted default-branch logic for the candidate-only Staging path.
// This file must be reviewed and installed on main before use.
import { readFileSync } from 'node:fs';

export const COMMUNITY_CANDIDATE_SCOPE = 'community-phase1-isolated';
export const COMMUNITY_MIGRATION_VERSION = '20261014052000';
export const COMMUNITY_ISSUE_NUMBER = 294;
export const COMMUNITY_PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_CANDIDATE_APPROVE ';
export const COMMUNITY_OWNER = 'bingohooah888-ai';
const REPO = COMMUNITY_OWNER + '/novelrise';
const SHA = /^[0-9a-f]{40}$/u;
const CONSUMPTION_MARKERS = [
  'NOVELIGHT_STAGING_COMMUNITY_CLAIMED ',
  'NOVELIGHT_STAGING_COMMUNITY_CONSUMED '
];
const EXPECTED_REQUEST_FIELDS = [
  'scope', 'mainSha', 'candidateSha', 'migration', 'confirmation'
];

function fail(message) {
  throw new Error('COMMUNITY_STAGING_APPROVAL_DENIED: ' + message);
}

function shape(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function parseCommand(body, prefix, keys) {
  if (typeof body !== 'string' || body.length > 2048 ||
    !body.startsWith(prefix)) fail('invalid approval command');
  let data;
  try {
    data = JSON.parse(body.slice(prefix.length));
  } catch {
    fail('invalid approval JSON');
  }
  if (!shape(data, keys)) fail('unexpected approval fields');
  return data;
}

export function assertCommunityCandidateAdmission({
  repository,
  issue,
  comment,
  main,
  pr,
  compare,
  ledgerPages
}) {
  if (repository !== REPO) fail('unexpected repository');
  if (!issue || issue.number !== COMMUNITY_ISSUE_NUMBER ||
    issue.title !== '[Staging Control] Supabase migration sync' ||
    issue.pull_request ||
    issue.user?.login !== COMMUNITY_OWNER) fail('not the fixed Staging control');
  if (!comment || !Number.isSafeInteger(comment.id) || comment.id < 1 ||
    comment.user?.login !== COMMUNITY_OWNER ||
    comment.author_association !== 'OWNER') fail('not an OWNER issue comment');
  if (!main || !SHA.test(main.object?.sha ?? '')) fail('main not resolved');

  const request = parseCommand(
    comment.body, COMMUNITY_PREFIX, EXPECTED_REQUEST_FIELDS
  );
  if (!pr || pr.number !== 2222 || pr.state !== 'open' ||
    pr.draft !== true || pr.merged === true || pr.base?.ref !== 'main' ||
    !SHA.test(pr.head?.sha ?? '') || !SHA.test(pr.base?.sha ?? '')) {
    fail('candidate PR is not open, draft and bound to main');
  }
  if (request.scope !== COMMUNITY_CANDIDATE_SCOPE ||
    request.confirmation !== 'STAGING APPROVED' ||
    request.migration !== COMMUNITY_MIGRATION_VERSION ||
    request.mainSha !== main.object.sha ||
    request.mainSha !== pr.base.sha ||
    request.candidateSha !== pr.head.sha ||
    request.mainSha === request.candidateSha) {
    fail('request target SHA or scope drift');
  }
  if (!compare || compare.status !== 'ahead' ||
    compare.behind_by !== 0 || compare.ahead_by < 1 ||
    compare.base_commit?.sha !== request.mainSha ||
    !SHA.test(compare.head_commit?.sha ?? '') ||
    compare.head_commit.sha !== request.candidateSha) {
    fail('candidate is not a proven descendant of current main');
  }
  if (!Array.isArray(ledgerPages) || ledgerPages.length < 1 ||
    ledgerPages.length > 20 ||
    !ledgerPages.every((page) => Array.isArray(page) && page.length <= 100) ||
    ledgerPages[ledgerPages.length - 1].length === 100) {
    fail('Staging approval ledger pagination incomplete');
  }
  for (const entry of ledgerPages.flat()) {
    if (!entry || typeof entry.body !== 'string') fail('invalid ledger entry');
    const marker = CONSUMPTION_MARKERS.find((x) => entry.body.startsWith(x));
    if (!marker) continue;
    const used = parseCommand(entry.body, marker, [
      'requestCommentId', 'mainSha', 'candidateSha', 'runId'
    ]);
    if (String(used.requestCommentId) === String(comment.id)) {
      fail('approval already claimed or consumed');
    }
  }
  return {
    currentMainSha: request.mainSha,
    candidateSha: request.candidateSha,
    migrationVersion: request.migration,
    requestCommentId: String(comment.id),
    scope: request.scope
  };
}

// Consume only event data and live GitHub API responses supplied by trusted
// checkout workflow; no ability to approve or mutate Staging by itself.
if (process.argv[2] === 'validate') {
  try {
    const [eventPath, mainPath, prPath, comparePath, ledgerPath] =
      process.argv.slice(3);
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const decision = assertCommunityCandidateAdmission({
      repository: event.repository?.full_name,
      issue: event.issue,
      comment: event.comment,
      main: JSON.parse(readFileSync(mainPath, 'utf8')),
      pr: JSON.parse(readFileSync(prPath, 'utf8')),
      compare: JSON.parse(readFileSync(comparePath, 'utf8')),
      ledgerPages: JSON.parse(readFileSync(ledgerPath, 'utf8'))
    });
    process.stdout.write(JSON.stringify(decision) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
