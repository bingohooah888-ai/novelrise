import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REVIEWED_FILES } from './account-deletion-preview-admission.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';
const TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const FIX_BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const APPROVE = 'NOVELIGHT_STRIPE_SANDBOX_READONLY_APPROVE ';
const CLAIMED = 'NOVELIGHT_STRIPE_SANDBOX_READONLY_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STRIPE_SANDBOX_READONLY_CONSUMED ';
const SHA = /^[a-f0-9]{40}$/u;
const LEDGER_KEYS = Object.freeze([
  'requestCommentId',
  'mainSha',
  'candidateSha',
  'runId'
]);

function deny() {
  throw new Error('STRIPE_SANDBOX_DIAGNOSTIC_ADMISSION_DENIED');
}

function parseMarker(body, prefix, fields) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(prefix)
  )
    deny();
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
    Object.keys(value).sort().join() !== [...fields].sort().join()
  )
    deny();
  return value;
}

export function admitStripeSandboxDiagnostic({
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
    issue?.number !== 188 ||
    event?.issue?.id !== issue?.id ||
    issue?.url !== ISSUE_URL ||
    issue?.title !== TITLE ||
    issue?.state !== 'open' ||
    issue?.locked !== false ||
    issue?.user?.login !== OWNER ||
    issue?.pull_request ||
    event?.issue?.state !== 'open' ||
    event?.issue?.locked !== false ||
    event?.comment?.user?.login !== OWNER ||
    event?.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event?.comment?.id) ||
    event.comment.id <= 0
  )
    deny();

  const grant = parseMarker(event.comment.body, APPROVE, [
    'scope',
    'mainSha',
    'candidateSha',
    'confirmation'
  ]);
  if (
    grant.scope !== 'stripe-sandbox-identity-readonly' ||
    grant.confirmation !== 'STAGING READONLY APPROVED' ||
    !SHA.test(grant.mainSha) ||
    !SHA.test(grant.candidateSha) ||
    grant.mainSha === grant.candidateSha ||
    mainRef?.object?.sha !== grant.mainSha ||
    checkedOutSha !== grant.mainSha ||
    pr?.number !== 2785 ||
    pr?.state !== 'open' ||
    pr?.draft !== true ||
    pr?.merged === true ||
    pr?.user?.login !== OWNER ||
    pr?.base?.ref !== 'main' ||
    pr.base?.sha !== grant.mainSha ||
    pr?.head?.sha !== grant.candidateSha ||
    pr?.head?.ref !== FIX_BRANCH ||
    pr?.head?.repo?.full_name !== REPO
  )
    deny();

  if (
    compare?.status !== 'ahead' ||
    compare?.behind_by !== 0 ||
    compare?.base_commit?.sha !== grant.mainSha ||
    !Number.isSafeInteger(compare?.total_commits) ||
    compare.total_commits < 1 ||
    compare.total_commits > 250 ||
    compare?.ahead_by !== compare.total_commits ||
    !Array.isArray(compare?.commits) ||
    compare.commits.length !== compare.total_commits ||
    compare.commits.at(-1)?.sha !== grant.candidateSha ||
    !Array.isArray(compare?.files) ||
    compare.files.length !== REVIEWED_FILES.length
  )
    deny();

  const actual = new Map();
  for (const file of compare.files) {
    if (!file || typeof file.filename !== 'string' || actual.has(file.filename))
      deny();
    actual.set(file.filename, file);
  }
  for (const file of REVIEWED_FILES) {
    const found = actual.get(file.path);
    if (found?.sha !== file.sha || found.status !== file.status) deny();
  }

  // Pages must be exhaustive. A full last page means GitHub may have more
  // comments; require a new readonly review instead of risking a reused grant.
  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 50 ||
    !ledgerPages.every((page) => Array.isArray(page) && page.length <= 100) ||
    ledgerPages.at(-1).length === 100
  )
    deny();
  for (const comment of ledgerPages.flat()) {
    if (typeof comment?.body !== 'string') deny();
    const prefix = comment.body.startsWith(CLAIMED)
      ? CLAIMED
      : comment.body.startsWith(CONSUMED)
        ? CONSUMED
        : null;
    if (!prefix) continue;
    const fields =
      prefix === CONSUMED ? [...LEDGER_KEYS, 'result'] : LEDGER_KEYS;
    const entry = parseMarker(comment.body, prefix, fields);
    if (String(entry.requestCommentId) === String(event.comment.id)) deny();
  }
  return Object.freeze({
    mainSha: grant.mainSha,
    candidateSha: grant.candidateSha,
    approvalCommentId: String(event.comment.id)
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 9) deny();
    const objs = process.argv
      .slice(2, 8)
      .map((file) => JSON.parse(readFileSync(file, 'utf8')));
    const out = admitStripeSandboxDiagnostic({
      event: objs[0],
      issue: objs[1],
      mainRef: objs[2],
      pr: objs[3],
      compare: objs[4],
      ledgerPages: objs[5],
      checkedOutSha: process.argv[8]
    });
    process.stdout.write(JSON.stringify(out) + '\n');
  } catch {
    // Never emit untrusted comment/API contents.
    console.error('STRIPE_SANDBOX_DIAGNOSTIC_ADMISSION_DENIED');
    process.exitCode = 1;
  }
}
