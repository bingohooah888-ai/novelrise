import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REVIEWED_FILES } from './account-deletion-preview-admission.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';
const ISSUE_TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const FIX_BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const APPROVE = 'NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_APPROVE ';
const CLAIMED = 'NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_CONSUMED ';
const SHA = /^[0-9a-f]{40}$/u;

function deny() {
  throw new Error('STRIPE_TEST_PREMIUM_PRICE_ADMISSION_DENIED');
}

function parse(body, prefix, keys) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(prefix)
  )
    deny();
  let json;
  try {
    json = JSON.parse(body.slice(prefix.length));
  } catch {
    deny();
  }
  if (
    !json ||
    typeof json !== 'object' ||
    Array.isArray(json) ||
    Object.keys(json).sort().join(',') !== [...keys].sort().join(',')
  )
    deny();
  return json;
}

export function admitStripeTestPremiumPriceOnce({
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
    event?.issue?.id !== issue?.id ||
    event?.issue?.state !== 'open' ||
    event?.issue?.locked !== false ||
    issue?.number !== 188 ||
    issue?.url !== ISSUE_URL ||
    issue?.title !== ISSUE_TITLE ||
    issue?.state !== 'open' ||
    issue?.locked !== false ||
    issue?.pull_request ||
    issue?.user?.login !== OWNER ||
    event?.comment?.user?.login !== OWNER ||
    event?.comment?.user?.id !== 317436651 ||
    event?.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event?.comment?.id) ||
    event.comment.id < 1
  )
    deny();

  const approval = parse(event.comment.body, APPROVE, [
    'scope',
    'mainSha',
    'candidateSha',
    'confirmation'
  ]);
  if (
    approval.scope !== 'account-82-stripe-test-premium-beta-price-once' ||
    approval.confirmation !== 'STAGING TEST PRICE WRITE APPROVED' ||
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
    pr?.head?.ref !== FIX_BRANCH ||
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
    if (!file || typeof file.filename !== 'string' || actual.has(file.filename))
      deny();
    actual.set(file.filename, file);
  }
  for (const file of REVIEWED_FILES) {
    const found = actual.get(file.path);
    if (found?.sha !== file.sha || found.status !== file.status) deny();
  }

  // All ledger pages must be present; never assume a truncated ledger is safe.
  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 50 ||
    !ledgerPages.every((page) => Array.isArray(page) && page.length <= 100) ||
    ledgerPages.at(-1).length === 100
  )
    deny();

  let approvedCommentCount = 0;
  for (const comment of ledgerPages.flat()) {
    if (typeof comment?.body !== 'string') deny();
    if (comment.id === event.comment.id) {
      approvedCommentCount += 1;
      if (comment.body !== event.comment.body) deny();
    }
    const marker = comment.body.startsWith(CLAIMED)
      ? CLAIMED
      : comment.body.startsWith(CONSUMED)
        ? CONSUMED
        : null;
    if (!marker) continue;
    const data = parse(
      comment.body,
      marker,
      marker === CONSUMED
        ? ['requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result']
        : ['requestCommentId', 'mainSha', 'candidateSha', 'runId']
    );
    if (String(data.requestCommentId) === String(event.comment.id)) deny();
  }
  if (approvedCommentCount !== 1) deny();

  return Object.freeze({
    mainSha: approval.mainSha,
    candidateSha: approval.candidateSha,
    approvalCommentId: String(event.comment.id)
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 9) deny();
    const files = process.argv
      .slice(2, 8)
      .map((file) => JSON.parse(readFileSync(file, 'utf8')));
    const admitted = admitStripeTestPremiumPriceOnce({
      event: files[0],
      issue: files[1],
      mainRef: files[2],
      pr: files[3],
      compare: files[4],
      ledgerPages: files[5],
      checkedOutSha: process.argv[8]
    });
    process.stdout.write(JSON.stringify(admitted) + '\n');
  } catch {
    // Never print untrusted issue contents, tokens, or raw exceptions.
    console.error('STRIPE_TEST_PREMIUM_PRICE_ADMISSION_DENIED');
    process.exitCode = 1;
  }
}
