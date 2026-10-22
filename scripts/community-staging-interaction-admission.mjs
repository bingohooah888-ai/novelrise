// Trusted-main, OWNER-only, one-use admission for rollback-only Staging checks.
// An approval from chat is not a GitHub OWNER comment or a reused approval.
import { readFileSync } from 'node:fs';

export const SCOPE = 'community-phase1-interaction-rollback';
export const MIGRATION = '20261014052000';
export const PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_INTERACTION_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_COMMUNITY_INTERACTION_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_COMMUNITY_INTERACTION_CONSUMED ';
const OWNER = 'bingohooah888-ai';
const SHA = /^[0-9a-f]{40}$/u;

function deny(reason) {
  throw new Error('COMMUNITY_STAGING_INTERACTION_DENIED: ' + reason);
}

function record(body, prefix, fields) {
  if (typeof body !== 'string' || body.length > 2048 ||
      !body.startsWith(prefix)) deny('invalid ledger marker');
  let value;
  try {
    value = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('malformed approval JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    deny('wrong approval fields');
  }
  return value;
}

export function assertCommunityInteractionAdmission({
  repository, issue, comment, main, pr, compare, ledgerPages
}) {
  if (repository !== OWNER + '/novelrise' ||
      issue?.number !== 294 || issue?.state !== 'open' ||
      issue?.title !== '[Staging Control] Supabase migration sync' ||
      issue?.pull_request || issue?.user?.login !== OWNER) {
    deny('wrong OWNER Staging control issue');
  }
  if (!Number.isSafeInteger(comment?.id) || comment.id <= 0 ||
      comment?.user?.login !== OWNER ||
      comment.author_association !== 'OWNER') {
    deny('OWNER authorization required');
  }
  const req = record(comment.body, PREFIX, [
    'scope', 'mainSha', 'candidateSha', 'migration', 'confirmation'
  ]);
  if (!SHA.test(main?.object?.sha ?? '') ||
      !SHA.test(pr?.head?.sha ?? '') ||
      !SHA.test(pr?.base?.sha ?? '') ||
      req.scope !== SCOPE ||
      req.mainSha !== main.object.sha ||
      req.candidateSha !== pr.head.sha ||
      req.mainSha !== pr.base.sha ||
      req.migration !== MIGRATION ||
      req.confirmation !== 'STAGING APPROVED' ||
      pr.number !== 2222 || pr.state !== 'open' ||
      pr.draft !== true || pr.merged === true ||
      pr.base.ref !== 'main' ||
      pr.head.repo?.full_name !== repository) {
    deny('wrong main, candidate PR or approval scope');
  }
  if (compare?.status !== 'ahead' ||
      compare.behind_by !== 0 ||
      compare.base_commit?.sha !== req.mainSha ||
      !Number.isSafeInteger(compare.total_commits) ||
      compare.total_commits < 1 ||
      compare.total_commits > 250 ||
      compare.ahead_by !== compare.total_commits ||
      !Array.isArray(compare.commits) ||
      compare.commits.length !== compare.total_commits ||
      compare.commits.at(-1)?.sha !== req.candidateSha) {
    deny('candidate is not complete current-main descendant');
  }
  if (!Array.isArray(ledgerPages) || ledgerPages.length === 0 ||
      ledgerPages.length > 20 ||
      !ledgerPages.every((page) => Array.isArray(page) &&
        page.length <= 100) ||
      ledgerPages.at(-1).length === 100) {
    deny('incomplete Staging approval ledger');
  }
  for (const item of ledgerPages.flat()) {
    if (typeof item?.body !== 'string') deny('malformed ledger row');
    const marker = item.body.startsWith(CLAIMED) ? CLAIMED :
      item.body.startsWith(CONSUMED) ? CONSUMED : null;
    if (!marker) continue;
    const entry = record(item.body, marker, marker === CLAIMED
      ? ['requestCommentId','mainSha','candidateSha','runId']
      : ['requestCommentId','mainSha','candidateSha','runId','result']);
    if (String(entry.requestCommentId) === String(comment.id)) {
      deny('approval has already been claimed/consumed');
    }
  }
  return {
    mainSha: req.mainSha,
    candidateSha: req.candidateSha,
    migration: MIGRATION,
    requestCommentId: String(comment.id)
  };
}

if (process.argv[2] === 'validate') {
  try {
    const inputs = process.argv.slice(3);
    if (inputs.length !== 5) deny('five JSON input files required');
    const [event, main, pr, compare, ledgerPages] = inputs.map(
      (path) => JSON.parse(readFileSync(path, 'utf8'))
    );
    const result = assertCommunityInteractionAdmission({
      repository: event.repository?.full_name,
      issue: event.issue, comment: event.comment,
      main, pr, compare, ledgerPages
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
