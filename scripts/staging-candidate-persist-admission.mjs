// Trusted main-only admission contract for unmerged migration testing.
// ONLY Issue #294's verified owner comment can request one reviewed persistent Staging SQL transaction.
// Candidate scripts and workflows are NEVER executed.
import { readFileSync } from 'node:fs';

export const PREFIX = 'NOVELIGHT_STAGING_CANDIDATE_PERSIST_APPROVE ';
export const CLAIM = 'NOVELIGHT_STAGING_CANDIDATE_PERSIST_CLAIMED ';
export const CONSUMED = 'NOVELIGHT_STAGING_CANDIDATE_PERSIST_CONSUMED ';
const OWNER = 'bingohooah888-ai';
const REPOSITORY = OWNER + '/novelrise';
const SHA = /^[a-f0-9]{40}$/u;
const VERSION = /^20[0-9]{12}$/u;
const FIELDS = ['scope', 'mainSha', 'candidateSha', 'pr', 'migration', 'confirmation'];

function deny(reason) {
  throw new Error('STAGING_CANDIDATE_PERSIST_DENIED: ' + reason);
}
function objectWithKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function parse(body, prefix, keys) {
  if (typeof body !== 'string' || body.length > 1800 || !body.startsWith(prefix)) {
    deny('unexpected comment format');
  }
  let value;
  try { value = JSON.parse(body.slice(prefix.length)); }
  catch { deny('invalid JSON'); }
  if (!objectWithKeys(value, keys)) deny('comment fields not exact');
  return value;
}
export function expectedCandidateArtifactPaths(files, version) {
  if (!VERSION.test(version) || !Array.isArray(files) ||
      files.length < 3 || files.length > 100) deny('invalid candidate diff');
  const groups = [
    ['migration', new RegExp('^supabase/migrations/' + version + '_[a-z0-9_]+\\.sql$','u')],
    ['precheck', new RegExp('^supabase/checks/' + version + '_[a-z0-9_]+_precheck\\.sql$','u')],
    ['postcheck', new RegExp('^supabase/checks/' + version + '_[a-z0-9_]+_postcheck\\.sql$','u')],
    ['rollback', new RegExp('^supabase/rollback/' + version + '_[a-z0-9_]+_rollback\\.sql$','u')]
  ];
  const result = {};
  for (const [key,pattern] of groups) {
    const matches = files.filter(f => pattern.test(f.filename));
    if (matches.length !== 1 || matches[0].status !== 'added' ||
      !SHA.test(matches[0].sha || '')) deny('artifact missing, modified or ambiguous: ' + key);
    result[key] = { path: matches[0].filename, sha: matches[0].sha };
  }
  const otherMigrations = files.filter(f=>f.filename.startsWith('supabase/migrations/') &&
    f.filename.endsWith('.sql') && f.filename !== result.migration.path);
  if (otherMigrations.length) deny('multiple migrations in candidate PR');
  const otherChecks = files.filter(f => (
    f.filename.startsWith('supabase/checks/') ||
    f.filename.startsWith('supabase/rollback/')
  ) && f.filename.endsWith('.sql') &&
    ![result.precheck.path,result.postcheck.path,result.rollback.path].includes(f.filename));
  if (otherChecks.length) deny('unrelated check or rollback files in candidate PR');
  return result;
}

export function verifyCandidateAdmission({
  repository, issue, comment, main, pr, compare, files, ledgerPages
}) {
  if (repository !== REPOSITORY || issue?.number !== 294 ||
      issue.state !== 'open' ||
      issue.title !== '[Staging Control] Supabase migration sync' ||
      issue.pull_request || issue.user?.login !== OWNER) {
    deny('unexpected staging control issue');
  }
  if (!Number.isSafeInteger(comment?.id) || comment.id < 1 ||
      comment.user?.login !== OWNER || comment.author_association !== 'OWNER') {
    deny('owner authenticated comment required');
  }
  const request = parse(comment.body, PREFIX, FIELDS);
  if (request.scope !== 'candidate-db-persist' ||
      request.confirmation !== 'STAGING PERSIST APPROVED' ||
      !Number.isSafeInteger(request.pr) || request.pr < 1 ||
      !SHA.test(request.mainSha || '') || !SHA.test(request.candidateSha || '') ||
      !VERSION.test(request.migration || '')) deny('scope, SHA or version invalid');

  if (!SHA.test(main?.object?.sha || '') ||
      request.mainSha !== main.object.sha || request.mainSha === request.candidateSha) {
    deny('latest main or SHA changed');
  }
  if (!pr || pr.number !== request.pr || pr.state !== 'open' ||
      pr.draft !== true || pr.merged === true ||
      pr.base?.ref !== 'main' || pr.base?.sha !== request.mainSha ||
      pr.head?.repo?.full_name !== REPOSITORY ||
      pr.head?.sha !== request.candidateSha ||
      pr.changed_files > 100 || pr.changed_files !== files?.length) {
    deny('candidate PR not immutable, open draft, or based on current main');
  }
  if (compare?.status !== 'ahead' || compare.behind_by !== 0 ||
      compare.base_commit?.sha !== request.mainSha ||
      !Array.isArray(compare.commits) ||
      compare.total_commits !== compare.commits.length ||
      compare.commits.at(-1)?.sha !== request.candidateSha) {
    deny('candidate not a proven main descendant');
  }
  if (!Array.isArray(ledgerPages) || ledgerPages.length < 1 ||
      ledgerPages.length > 20 ||
      ledgerPages.some(page=>!Array.isArray(page) || page.length > 100) ||
      ledgerPages.at(-1).length === 100) deny('incomplete ledger pagination');

  for (const entry of ledgerPages.flat()) {
    if (!entry || typeof entry.body !== 'string') deny('invalid ledger item');
    const marker = [CLAIM,CONSUMED].find(p=>entry.body.startsWith(p));
    if (!marker) continue;
    const used = parse(entry.body, marker, marker===CLAIM ?
      ['requestCommentId','mainSha','candidateSha','runId'] :
      ['requestCommentId','mainSha','candidateSha','runId','result']);
    if (String(used.requestCommentId) === String(comment.id)) {
      deny('request was already claimed or consumed');
    }
  }
  return {
    pr: request.pr,
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    migration: request.migration,
    requestCommentId: String(comment.id),
    artifacts: expectedCandidateArtifactPaths(files, request.migration)
  };
}

if (process.argv[2] === 'validate') {
  try {
    const [eventFile, mainFile, prFile, compareFile, filesFile, ledgerFile] =
      process.argv.slice(3);
    if (process.argv.length !== 9) deny('exact validation inputs required');
    const event = JSON.parse(readFileSync(eventFile,'utf8'));
    const v = verifyCandidateAdmission({
      repository: event.repository?.full_name,
      issue: event.issue, comment: event.comment,
      main: JSON.parse(readFileSync(mainFile,'utf8')),
      pr: JSON.parse(readFileSync(prFile,'utf8')),
      compare: JSON.parse(readFileSync(compareFile,'utf8')),
      files: JSON.parse(readFileSync(filesFile,'utf8')),
      ledgerPages: JSON.parse(readFileSync(ledgerFile,'utf8'))
    });
    process.stdout.write(JSON.stringify(v) + '\n');
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
