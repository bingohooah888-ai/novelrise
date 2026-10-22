// Trusted-main owner approval gate for one dedicated Staging schema repair.
// Pure validation: no DB access, no issue posting, no deployment.
import { readFileSync } from 'node:fs';

export const SCOPE = 'community-phase1-forward-reconcile';
export const PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_FORWARD_APPROVE ';
export const OWNER = 'bingohooah888-ai';
export const ISSUE = 294;
export const MIGRATION = '20261014052000';
const SHA = /^[a-f0-9]{40}$/u;
const CLAIM = 'NOVELIGHT_STAGING_COMMUNITY_FORWARD_CLAIMED ';
const DONE = 'NOVELIGHT_STAGING_COMMUNITY_FORWARD_CONSUMED ';

function deny(reason) {
  throw new Error('COMMUNITY_FORWARD_APPROVAL_DENIED: ' + reason);
}
function exactObject(obj, keys) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).sort().join(',') === [...keys].sort().join(',');
}
function parse(body, prefix, keys) {
  if (typeof body !== 'string' || body.length > 2048 ||
    !body.startsWith(prefix)) deny('invalid approval record');
  let value;
  try {
    value = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid approval JSON');
  }
  if (!exactObject(value, keys)) deny('unexpected fields');
  return value;
}
export function validateForwardApproval({
  repository, issue, comment, main, pr, compare, ledgerPages
}) {
  if (repository !== OWNER + '/novelrise' ||
    issue?.number !== ISSUE ||
    issue?.state !== 'open' ||
    issue?.title !== '[Staging Control] Supabase migration sync' ||
    issue?.pull_request ||
    issue?.user?.login !== OWNER) deny('wrong Staging issue');
  if (!Number.isSafeInteger(comment?.id) || comment.id <= 0 ||
    comment.user?.login !== OWNER ||
    comment.author_association !== 'OWNER') deny('OWNER required');
  const request = parse(comment.body, PREFIX, [
    'scope', 'mainSha', 'candidateSha', 'migration', 'confirmation'
  ]);
  if (!SHA.test(main?.object?.sha || '') ||
    !SHA.test(pr?.head?.sha || '') ||
    !SHA.test(pr?.base?.sha || '') ||
    request.scope !== SCOPE ||
    request.mainSha !== main.object.sha ||
    request.mainSha !== pr.base.sha ||
    request.candidateSha !== pr.head.sha ||
    request.migration !== MIGRATION ||
    request.confirmation !== 'STAGING APPROVED' ||
    pr.number !== 2222 ||
    pr.state !== 'open' ||
    pr.draft !== true ||
    pr.merged === true ||
    pr.base.ref !== 'main' ||
    pr.head.repo?.full_name !== repository) deny('unapproved head/base/scope');
  if (compare?.status !== 'ahead' || compare.behind_by !== 0 ||
    compare.base_commit?.sha !== request.mainSha ||
    !Number.isSafeInteger(compare.total_commits) ||
    compare.total_commits < 1 ||
    !Array.isArray(compare.commits) ||
    compare.commits.length !== compare.total_commits ||
    compare.commits.at(-1)?.sha !== request.candidateSha) {
    deny('candidate not complete exact-main descendant');
  }
  if (!Array.isArray(ledgerPages) ||
    ledgerPages.length === 0 || ledgerPages.length > 20 ||
    !ledgerPages.every((page) =>
      Array.isArray(page) && page.length <= 100) ||
    ledgerPages.at(-1).length === 100) deny('incomplete approval ledger');
  for (const entry of ledgerPages.flat()) {
    if (typeof entry?.body !== 'string') deny('invalid ledger entry');
    const marker = entry.body.startsWith(CLAIM) ? CLAIM :
      entry.body.startsWith(DONE) ? DONE : null;
    if (!marker) continue;
    const used = parse(entry.body, marker, marker === CLAIM
      ? ['requestCommentId', 'mainSha', 'candidateSha', 'runId']
      : ['requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result']);
    if (String(used.requestCommentId) === String(comment.id)) {
      deny('approval already claimed');
    }
  }
  return {
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    requestId: String(comment.id)
  };
}

if (process.argv[2] === 'validate') {
  try {
    const args = process.argv.slice(3);
    if (args.length !== 5) deny('five input JSON paths required');
    const [event, main, pr, compare, ledgerPages] =
      args.map((file) => JSON.parse(readFileSync(file, 'utf8')));
    const result = validateForwardApproval({
      repository: event.repository?.full_name,
      issue: event.issue, comment: event.comment,
      main, pr, compare, ledgerPages
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
