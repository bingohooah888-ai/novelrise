// Trusted main-only admission for verifying ONE already-built protected Preview.
// No deployment creation and no candidate source execution.
import { readFileSync } from 'node:fs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE_TITLE = '[Staging Approval Control] Preview / Staging cost gate';
export const REUSE_SHA = '0fb3cd158c4ef2b16185abb7b628b161cd0f0e92';
export const REUSE_URL = 'https://novelrise-ibyeza739-ranobe1.vercel.app';
export const REUSE_SCOPE = 'community-phase1-existing-preview-readonly';
export const REUSE_PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_REUSE_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_COMMUNITY_REUSE_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_COMMUNITY_REUSE_CONSUMED ';
const EXISTING_APPROVAL = 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED ';
const PREVIOUS_REQUEST = '6199670925';
const PREVIOUS_RUN = '38788191875';
const SHA = /^[a-f0-9]{40}$/u;

function deny(reason) {
  throw new Error('COMMUNITY_PREVIEW_REUSE_DENIED: ' + reason);
}
function parse(body, marker, fields) {
  if (typeof body !== 'string' || body.length > 2048 ||
      !body.startsWith(marker)) deny('invalid approval/ledger marker');
  let value;
  try {
    value = JSON.parse(body.slice(marker.length));
  } catch {
    deny('invalid approval/ledger JSON');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).sort().join(',') !== fields.sort().join(',')) {
    deny('unknown or missing fields');
  }
  return value;
}

export function assertCommunityReuseAdmission(input) {
  const { repository, issue, comment, main, ledgerPages } = input;
  if (repository !== REPO || issue?.number !== 188 ||
      issue?.title !== ISSUE_TITLE || issue?.pull_request ||
      issue?.user?.login !== OWNER) deny('wrong OWNER control issue');
  if (!Number.isSafeInteger(comment?.id) || comment.id < 1 ||
      comment.user?.login !== OWNER ||
      comment.author_association !== 'OWNER') deny('not OWNER request');
  if (!SHA.test(main?.object?.sha ?? '')) deny('main unavailable');
  const request = parse(comment.body, REUSE_PREFIX, [
    'scope', 'mainSha', 'candidateSha', 'previewUrl', 'confirmation'
  ]);
  if (request.scope !== REUSE_SCOPE ||
      request.confirmation !== 'STAGING APPROVED' ||
      request.mainSha !== main.object.sha ||
      request.candidateSha !== REUSE_SHA ||
      request.previewUrl !== REUSE_URL) deny('scope, SHA, or target mismatch');
  if (!Array.isArray(ledgerPages) || ledgerPages.length < 1 ||
      ledgerPages.length > 20 ||
      !ledgerPages.every((p) => Array.isArray(p) && p.length <= 100) ||
      ledgerPages.at(-1).length === 100) deny('incomplete approval ledger');
  let originalConsumed = false;
  for (const item of ledgerPages.flat()) {
    if (!item || typeof item.body !== 'string') deny('invalid ledger row');
    if (item.body.startsWith(EXISTING_APPROVAL) &&
        item.user?.login === 'github-actions[bot]') {
      const original = parse(item.body, EXISTING_APPROVAL, [
        'requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result'
      ]);
      if (String(original.requestCommentId) === PREVIOUS_REQUEST &&
          String(original.runId) === PREVIOUS_RUN &&
          original.candidateSha === REUSE_SHA) originalConsumed = true;
    }
    const marker = item.body.startsWith(CLAIMED)
      ? CLAIMED
      : item.body.startsWith(CONSUMED) ? CONSUMED : null;
    if (!marker) continue;
    const consumed = parse(item.body, marker, marker === CLAIMED
      ? ['requestCommentId', 'mainSha', 'candidateSha', 'runId']
      : ['requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result']);
    if (String(consumed.requestCommentId) === String(comment.id)) {
      deny('reuse approval already claimed or consumed');
    }
  }
  if (!originalConsumed) deny('existing Preview origin not ledger-proven');
  return {
    mainSha: request.mainSha,
    candidateSha: REUSE_SHA,
    previewUrl: REUSE_URL,
    requestCommentId: String(comment.id)
  };
}

if (process.argv[2] === 'validate') {
  try {
    const paths = process.argv.slice(3);
    if (paths.length !== 3) deny('event, main, and ledger required');
    const [event, main, ledgerPages] = paths.map(
      (p) => JSON.parse(readFileSync(p, 'utf8'))
    );
    const result = assertCommunityReuseAdmission({
      repository: event.repository?.full_name,
      issue: event.issue,
      comment: event.comment,
      main,
      ledgerPages
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
