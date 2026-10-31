// Trusted-main admission for ONE PR #2698 Staging Preview + real Auth JWT proof.
// Pure validation: never reads secrets, contacts Staging, or triggers Vercel.
import { readFileSync } from 'node:fs';

export const PREFIX = 'NOVELIGHT_FOLLOW_STAGE_PROOF_APPROVE ';
export const CLAIM = 'NOVELIGHT_FOLLOW_STAGE_PROOF_CLAIMED ';
export const CONSUMED = 'NOVELIGHT_FOLLOW_STAGE_PROOF_CONSUMED ';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const SHA = /^[0-9a-f]{40}$/u;
const MAIN = 'main';
const PR = 2698;
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const MIGRATION = '20261031173000';
const BRANCH = 'feat/following-list-bookshelf-community-20261031';

function reject(reason) {
  throw new Error('FOLLOW_STAGE_PROOF_DENIED: ' + reason);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
}

function parse(body, prefix, keys) {
  if (typeof body !== 'string' || body.length > 1800 ||
      !body.startsWith(prefix)) reject('invalid ledger comment');
  let data;
  try {
    data = JSON.parse(body.slice(prefix.length));
  } catch {
    reject('invalid JSON');
  }
  if (!exactKeys(data, keys)) reject('invalid ledger shape');
  return data;
}

export function verifyFollowStageApproval({
  event, main, pr, compare, issue, pages
}) {
  const comment = event?.comment;
  if (event?.repository?.full_name !== REPO ||
      event?.issue?.number !== 294 || issue?.number !== 294 ||
      issue?.state !== 'open' ||
      issue?.title !== '[Staging Control] Supabase migration sync' ||
      issue?.user?.login !== OWNER || issue?.pull_request ||
      event.sender?.login !== OWNER || comment?.user?.login !== OWNER ||
      comment?.author_association !== 'OWNER' ||
      !Number.isSafeInteger(comment?.id) || comment.id < 1) {
    reject('OWNER-authenticated Issue 294 request required');
  }
  const request = parse(comment.body, PREFIX, [
    'scope', 'mainSha', 'candidateSha', 'pr', 'stagingProject',
    'migration', 'executionCount', 'confirmation'
  ]);
  if (request.scope !== 'follow-preview-real-jwt' ||
      request.confirmation !== 'STAGING FOLLOW PROOF APPROVED' ||
      request.pr !== PR || request.stagingProject !== STAGING ||
      request.migration !== MIGRATION || request.executionCount !== 1 ||
      !SHA.test(request.mainSha || '') ||
      !SHA.test(request.candidateSha || '')) {
    reject('scope/project/migration/count not pinned');
  }
  if (main?.object?.sha !== request.mainSha ||
      pr?.number !== PR || pr.state !== 'open' || pr.draft !== true ||
      pr.merged === true || pr.base?.ref !== MAIN ||
      pr.base?.sha !== request.mainSha ||
      pr.head?.ref !== BRANCH || pr.head?.repo?.full_name !== REPO ||
      pr.head?.sha !== request.candidateSha) {
    reject('current main or candidate PR SHA changed');
  }
  if (compare?.status !== 'ahead' || compare.behind_by !== 0 ||
      compare.base_commit?.sha !== request.mainSha ||
      compare.commits?.at(-1)?.sha !== request.candidateSha ||
      compare.commits?.length !== compare.total_commits) {
    reject('candidate is not the exact current-main descendant');
  }
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 20 ||
      pages.some((x) => !Array.isArray(x) || x.length > 100) ||
      pages.at(-1).length === 100) {
    reject('incomplete approval ledger');
  }
  for (const entry of pages.flat()) {
    if (typeof entry?.body !== 'string') reject('invalid ledger entry');
    const prefix = entry.body.startsWith(CLAIM)
      ? CLAIM : entry.body.startsWith(CONSUMED) ? CONSUMED : null;
    if (!prefix) continue;
    const used = parse(entry.body, prefix, prefix === CLAIM
      ? ['requestCommentId', 'mainSha', 'candidateSha', 'runId']
      : ['requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result']);
    if (String(used.requestCommentId) === String(comment.id)) {
      reject('approval already used');
    }
  }
  return {
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    requestCommentId: String(comment.id),
    stagingProject: STAGING,
    branch: BRANCH
  };
}

if (process.argv[2] === 'validate') {
  try {
    if (process.argv.length !== 9) reject('expected six JSON paths');
    const params = process.argv.slice(3).map(
      (path) => JSON.parse(readFileSync(path, 'utf8'))
    );
    process.stdout.write(JSON.stringify(verifyFollowStageApproval({
      event: params[0], main: params[1], pr: params[2],
      compare: params[3], issue: params[4], pages: params[5]
    })) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
