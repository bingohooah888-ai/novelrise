// Trusted default-branch, read-only admission logic. Never execute candidate code here.
import { readFileSync } from 'node:fs';
const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED ';
const SHA = /^[a-f0-9]{40}$/u;
function deny(message) { throw new Error('COMMUNITY_PREVIEW_DENIED: ' + message); }
function exactKeys(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}
function payload(body, prefix, fields) {
  if (typeof body !== 'string' || body.length > 2048 || !body.startsWith(prefix)) deny('invalid ledger/request marker');
  let value;
  try { value = JSON.parse(body.slice(prefix.length)); } catch { deny('unparseable JSON'); }
  if (!exactKeys(value, fields)) deny('unknown/missing fields');
  return value;
}
export function assertCommunityPreviewAdmission({repository, issue, comment, main, pr, compare, ledgerPages}) {
  if (repository !== REPO || issue?.number !== 188 ||
      issue?.title !== '[Staging Approval Control] Preview / Staging cost gate' ||
      issue?.pull_request || issue?.user?.login !== OWNER) deny('unexpected control issue');
  if (!Number.isSafeInteger(comment?.id) || comment.id < 1 ||
      comment?.user?.login !== OWNER || comment.author_association !== 'OWNER') deny('not an OWNER approval');
  const req = payload(comment.body, PREFIX, ['scope','mainSha','candidateSha','confirmation']);
  if (req.scope !== 'community-phase1-preview' || req.confirmation !== 'STAGING APPROVED' ||
      !SHA.test(req.mainSha) || !SHA.test(req.candidateSha) ||
      req.mainSha === req.candidateSha || req.mainSha !== main?.object?.sha) deny('scope or current main SHA mismatch');
  if (pr?.number !== 2222 || pr?.state !== 'open' || pr.draft !== true ||
      pr.merged === true || pr.base?.ref !== 'main' ||
      pr.base?.sha !== req.mainSha || pr.head?.sha !== req.candidateSha ||
      pr.head?.repo?.full_name !== REPO) deny('PR identity, candidate, or base moved');
  if (compare?.status !== 'ahead' || compare.behind_by !== 0 ||
      compare.base_commit?.sha !== req.mainSha ||
      !Number.isSafeInteger(compare.total_commits) ||
      compare.total_commits < 1 || compare.total_commits > 250 ||
      compare.ahead_by !== compare.total_commits ||
      !Array.isArray(compare.commits) ||
      compare.commits.length !== compare.total_commits ||
      compare.commits.at(-1)?.sha !== req.candidateSha) deny('candidate ancestry not proven');
  if (!Array.isArray(ledgerPages) || ledgerPages.length < 1 || ledgerPages.length > 20 ||
      !ledgerPages.every(page => Array.isArray(page) && page.length <= 100) ||
      ledgerPages.at(-1).length >= 100) deny('ledger pagination incomplete');
  for (const entry of ledgerPages.flat()) {
    if (!entry || typeof entry.body !== 'string') deny('invalid ledger entry');
    let marker = entry.body.startsWith(CLAIMED) ? CLAIMED : entry.body.startsWith(CONSUMED) ? CONSUMED : null;
    if (!marker) continue;
    const record = payload(entry.body, marker, ['requestCommentId','mainSha','candidateSha','runId',...(marker===CONSUMED?['result']:[])]);
    if (String(record.requestCommentId) === String(comment.id)) deny('approval already used');
  }
  return { mainSha:req.mainSha, candidateSha:req.candidateSha, requestCommentId:String(comment.id) };
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const [eventFile, mainFile, prFile, compareFile, ledgerFile] = process.argv.slice(2);
    if (!ledgerFile) deny('five input JSON files required');
    const event = JSON.parse(readFileSync(eventFile,'utf8'));
    const decision = assertCommunityPreviewAdmission({
      repository: event.repository?.full_name, issue: event.issue, comment:event.comment,
      main: JSON.parse(readFileSync(mainFile,'utf8')), pr:JSON.parse(readFileSync(prFile,'utf8')),
      compare: JSON.parse(readFileSync(compareFile,'utf8')),
      ledgerPages: JSON.parse(readFileSync(ledgerFile,'utf8'))
    });
    process.stdout.write(JSON.stringify(decision)+'\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
