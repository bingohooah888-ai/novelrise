// Trusted default-branch admission: one rollback-only Phase 1 Staging transaction.
import { readFileSync } from 'node:fs';

export const SCOPE = 'community-phase1-interaction-rollback';
export const CANDIDATE_SHA = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
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
  repository, issue, comment, main, ledgerPages
}) {
  if (repository !== OWNER + '/novelrise' ||
      issue?.number !== 294 ||
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
      req.scope !== SCOPE || req.mainSha !== main.object.sha ||
      req.candidateSha !== CANDIDATE_SHA ||
      req.migration !== MIGRATION ||
      req.confirmation !== 'STAGING APPROVED') {
    deny('not exact current main, migration or approval scope');
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
    const marker = item.body.startsWith(CLAIMED)
      ? CLAIMED
      : item.body.startsWith(CONSUMED) ? CONSUMED : null;
    if (!marker) continue;
    const entry = record(item.body, marker,
      marker === CLAIMED
        ? ['requestCommentId','mainSha','candidateSha','runId']
        : ['requestCommentId','mainSha','candidateSha','runId','result']);
    if (String(entry.requestCommentId) === String(comment.id)) {
      deny('approval has already been claimed/consumed');
    }
  }
  return {
    mainSha: req.mainSha,
    candidateSha: CANDIDATE_SHA,
    migration: MIGRATION,
    requestCommentId: String(comment.id)
  };
}
if (process.argv[2] === 'validate') {
  try {
    const [e, m, ledger] = process.argv.slice(3).map(
      (path) => JSON.parse(readFileSync(path, 'utf8'))
    );
    if (!ledger) deny('event, main and ledger required');
    const result = assertCommunityInteractionAdmission({
      repository: e.repository?.full_name,
      issue: e.issue,
      comment: e.comment,
      main: m,
      ledgerPages: ledger
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
