import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REVIEWED_FILES } from './account-deletion-preview-admission.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';
const TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const CANDIDATE_REF = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const PREFIX = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREMIUM_E2E_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREMIUM_E2E_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREMIUM_E2E_CONSUMED ';
const SHA = /^[a-f0-9]{40}$/u;

function deny() {
  throw new Error('PREMIUM_STAGING_ADMISSION_DENIED');
}

function parseRecord(body, prefix, keys) {
  if (!body?.startsWith(prefix) || body.length > 2048) deny();
  let record;
  try {
    record = JSON.parse(body.slice(prefix.length));
  } catch {
    deny();
  }
  if (
    !record ||
    Array.isArray(record) ||
    typeof record !== 'object' ||
    Object.keys(record).sort().join('|') !== [...keys].sort().join('|')
  )
    deny();
  return record;
}

export function admitPremiumStagingOnce({
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
    event.issue.id !== issue?.id ||
    event.issue.state !== 'open' ||
    event.issue.locked !== false ||
    issue?.id !== 5273934770 ||
    issue?.url !== ISSUE_URL ||
    issue?.number !== 188 ||
    issue?.title !== TITLE ||
    issue?.state !== 'open' ||
    issue?.locked !== false ||
    issue?.user?.login !== OWNER ||
    issue?.pull_request ||
    event?.comment?.user?.login !== OWNER ||
    event?.comment?.user?.id !== 317436651 ||
    event?.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event?.comment?.id) ||
    event.comment.id < 1
  )
    deny();

  const approval = parseRecord(event.comment.body, PREFIX, [
    'scope',
    'mainSha',
    'candidateSha',
    'confirmation'
  ]);
  if (
    approval.scope !== 'account-deletion-premium-staging-e2e-once' ||
    approval.confirmation !== 'PREMIUM STAGING JWT E2E APPROVED' ||
    !SHA.test(approval.mainSha) ||
    !SHA.test(approval.candidateSha) ||
    approval.mainSha === approval.candidateSha ||
    mainRef?.object?.sha !== approval.mainSha ||
    checkedOutSha !== approval.mainSha ||
    pr?.number !== 2785 ||
    pr?.state !== 'open' ||
    pr?.draft !== true ||
    pr?.merged === true ||
    pr?.user?.login !== OWNER ||
    pr?.base?.ref !== 'main' ||
    pr?.base?.sha !== approval.mainSha ||
    pr?.head?.ref !== CANDIDATE_REF ||
    pr?.head?.sha !== approval.candidateSha ||
    pr?.head?.repo?.full_name !== REPO
  )
    deny();

  if (
    compare?.status !== 'ahead' ||
    compare?.behind_by !== 0 ||
    compare?.base_commit?.sha !== approval.mainSha ||
    !Number.isSafeInteger(compare?.total_commits) ||
    compare.total_commits < 1 ||
    compare.total_commits > 250 ||
    compare?.ahead_by !== compare.total_commits ||
    !Array.isArray(compare?.commits) ||
    compare.commits.length !== compare.total_commits ||
    compare.commits.at(-1)?.sha !== approval.candidateSha ||
    !Array.isArray(compare?.files) ||
    compare.files.length !== REVIEWED_FILES.length
  )
    deny();
  const actual = new Map();
  for (const file of compare.files) {
    if (!file?.filename || actual.has(file.filename)) deny();
    actual.set(file.filename, file);
  }
  for (const fixed of REVIEWED_FILES) {
    const entry = actual.get(fixed.path);
    if (entry?.sha !== fixed.sha || entry?.status !== fixed.status) deny();
  }

  // Every ledger page must be known; a used grant is never replayable.
  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 50 ||
    !ledgerPages.every((p) => Array.isArray(p) && p.length <= 100) ||
    ledgerPages.at(-1).length === 100
  )
    deny();

  let foundGrant = 0;
  for (const comment of ledgerPages.flat()) {
    if (typeof comment?.body !== 'string') deny();
    if (comment.id === event.comment.id) {
      foundGrant += 1;
      if (comment.body !== event.comment.body || comment.user?.login !== OWNER)
        deny();
    }
    const prefix = comment.body.startsWith(CLAIMED)
      ? CLAIMED
      : comment.body.startsWith(CONSUMED)
        ? CONSUMED
        : null;
    if (prefix) {
      const record = parseRecord(
        comment.body,
        prefix,
        prefix === CONSUMED
          ? ['requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result']
          : ['requestCommentId', 'mainSha', 'candidateSha', 'runId']
      );
      if (String(record.requestCommentId) === String(event.comment.id)) deny();
    }
  }
  if (foundGrant !== 1) deny();
  return Object.freeze({
    mainSha: approval.mainSha,
    candidateSha: approval.candidateSha,
    approvalCommentId: String(event.comment.id),
    candidateRef: CANDIDATE_REF
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 9) deny();
    const args = process.argv
      .slice(2, 8)
      .map((file) => JSON.parse(readFileSync(file, 'utf8')));
    const result = admitPremiumStagingOnce({
      event: args[0],
      issue: args[1],
      mainRef: args[2],
      pr: args[3],
      compare: args[4],
      ledgerPages: args[5],
      checkedOutSha: process.argv[8]
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    console.error('PREMIUM_STAGING_ADMISSION_DENIED');
    process.exitCode = 1;
  }
}
