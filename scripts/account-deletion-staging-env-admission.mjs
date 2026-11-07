import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REVIEWED_FILES } from './account-deletion-preview-admission.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';
const CANDIDATE_BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const APPROVE = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_CONSUMED ';
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const LEDGER_FIELDS = ['requestCommentId', 'mainSha', 'candidateSha', 'runId'];

function deny() {
  throw new Error('ACCOUNT_ENV_ADMISSION_DENIED');
}

function parseMarker(body, prefix, keys) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(prefix)
  ) {
    deny();
  }
  let value;
  try {
    value = JSON.parse(body.slice(prefix.length));
  } catch {
    deny();
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  ) {
    deny();
  }
  return value;
}

// Caller MUST obtain each of these objects independently from fresh GitHub APIs.
// All values are treated as untrusted; this routine does not use credentials.
export function admitAccountEnvProvision({
  event,
  issue,
  mainRef,
  pr,
  compare,
  ledgerPages,
  checkedOutSha
}) {
  if (
    event?.repository?.full_name !== REPO ||
    event?.issue?.number !== 188 ||
    event.issue?.id !== issue?.id ||
    issue?.number !== 188 ||
    issue?.url !== ISSUE_URL ||
    issue?.state !== 'open' ||
    issue?.locked !== false ||
    issue?.title !== TITLE ||
    issue?.user?.login !== OWNER ||
    issue?.pull_request ||
    event?.issue?.state !== 'open' ||
    event.issue?.locked !== false ||
    event?.comment?.user?.login !== OWNER ||
    event?.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event.comment?.id) ||
    event.comment.id <= 0
  ) {
    deny();
  }

  const request = parseMarker(event.comment.body, APPROVE, [
    'scope',
    'mainSha',
    'candidateSha',
    'confirmation'
  ]);
  if (
    request.scope !== 'account-deletion-env-provision' ||
    request.confirmation !== 'STAGING APPROVED' ||
    !SHA_PATTERN.test(request.mainSha) ||
    !SHA_PATTERN.test(request.candidateSha) ||
    request.mainSha === request.candidateSha ||
    checkedOutSha !== request.mainSha ||
    mainRef?.object?.sha !== request.mainSha ||
    pr?.number !== 2785 ||
    pr?.state !== 'open' ||
    pr?.draft !== true ||
    pr?.merged === true ||
    pr?.user?.login !== OWNER ||
    pr?.base?.ref !== 'main' ||
    pr.base?.sha !== request.mainSha ||
    pr?.head?.ref !== CANDIDATE_BRANCH ||
    pr.head?.sha !== request.candidateSha ||
    pr.head?.repo?.full_name !== REPO
  ) {
    deny();
  }

  if (
    compare?.status !== 'ahead' ||
    compare?.behind_by !== 0 ||
    compare?.base_commit?.sha !== request.mainSha ||
    !Number.isSafeInteger(compare?.total_commits) ||
    compare.total_commits < 1 ||
    compare.total_commits > 250 ||
    compare.ahead_by !== compare.total_commits ||
    !Array.isArray(compare.commits) ||
    compare.commits.length !== compare.total_commits ||
    compare.commits.at(-1)?.sha !== request.candidateSha ||
    !Array.isArray(compare.files) ||
    compare.files.length !== REVIEWED_FILES.length
  ) {
    deny();
  }
  const actual = new Map();
  for (const file of compare.files) {
    if (!file || typeof file.filename !== 'string' || actual.has(file.filename))
      deny();
    actual.set(file.filename, file);
  }
  for (const file of REVIEWED_FILES) {
    if (
      actual.get(file.path)?.sha !== file.sha ||
      actual.get(file.path)?.status !== file.status
    ) {
      deny();
    }
  }

  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 50 ||
    !ledgerPages.every((page) => Array.isArray(page) && page.length <= 100) ||
    ledgerPages.at(-1).length === 100
  ) {
    deny();
  }
  for (const comment of ledgerPages.flat()) {
    if (!comment || typeof comment.body !== 'string') deny();
    const prefix = comment.body.startsWith(CLAIMED)
      ? CLAIMED
      : comment.body.startsWith(CONSUMED)
        ? CONSUMED
        : null;
    if (!prefix) continue;
    const fields =
      prefix === CONSUMED ? [...LEDGER_FIELDS, 'result'] : LEDGER_FIELDS;
    const marker = parseMarker(comment.body, prefix, fields);
    if (String(marker.requestCommentId) === String(event.comment.id)) deny();
  }

  return Object.freeze({
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    candidateRef: CANDIDATE_BRANCH,
    approvalCommentId: String(event.comment.id)
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 9) deny();
    const paths = process.argv.slice(2, 8);
    const objects = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
    const decision = admitAccountEnvProvision({
      event: objects[0],
      issue: objects[1],
      mainRef: objects[2],
      pr: objects[3],
      compare: objects[4],
      ledgerPages: objects[5],
      checkedOutSha: process.argv[8]
    });
    process.stdout.write(JSON.stringify(decision) + '\n');
  } catch {
    // Neither user-created comments nor API payloads may appear in failure logs.
    console.error('ACCOUNT_ENV_ADMISSION_DENIED');
    process.exitCode = 1;
  }
}
