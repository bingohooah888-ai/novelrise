import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';
const TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const PR_NUMBER = 2785;
const PR_REF = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const SHA = /^[0-9a-f]{40}$/u;
const PREFIX = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_CONSUMED ';
const FREE_PREVIEW_APPROVE =
  'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PREVIEW_APPROVE ';
const FREE_PROOF_APPROVE =
  'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PROOF_APPROVE ';
const FREE_PREVIEW_CLAIMED =
  'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PREVIEW_CLAIMED ';
const FREE_PREVIEW_CONSUMED =
  'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PREVIEW_CONSUMED ';
const FREE_PROOF_CLAIMED =
  'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PROOF_CLAIMED ';
const FREE_PROOF_CONSUMED =
  'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PROOF_CONSUMED ';
const LEDGER_PREFIXES = Object.freeze([
  [CLAIMED, false],
  [CONSUMED, true],
  [FREE_PREVIEW_CLAIMED, false],
  [FREE_PREVIEW_CONSUMED, true],
  [FREE_PROOF_CLAIMED, false],
  [FREE_PROOF_CONSUMED, true]
]);

// The reviewed account deletion PR #2785 file blobs at b008772e5e77. Changing one
// requires a separate trusted-main review of this allowlist (never self-expand).
export const REVIEWED_FILES = Object.freeze([
  {
    path: 'account-settings.html',
    status: 'modified',
    sha: 'd73bda6d16f7519c6518aae1590ef0e901b3bd78'
  },
  {
    path: 'api/_lib/delete-account.js',
    status: 'modified',
    sha: 'ee4ee594594c78589988cbf35e07f0e778e44787'
  },
  {
    path: 'docs/ACCOUNT-DELETION-OPERATIONS.md',
    status: 'added',
    sha: 'c4bb30ca8974c6ce2743d33d4a4e7b49916684fd'
  },
  {
    path: 'docs/DOCUMENT-SOURCE-OF-TRUTH.md',
    status: 'modified',
    sha: '2686dfe327fd146f0272c0c4d4364c5904760805'
  },
  {
    path: 'tests/account-deletion-api.test.mjs',
    status: 'modified',
    sha: 'd033e6eeea2c1726899043fa7598bb756477185f'
  },
  {
    path: 'tests/account-deletion-page.test.mjs',
    status: 'modified',
    sha: 'cdeacf38856ea5fd2d9def3b3668629cc2db0e2d'
  },
  {
    path: 'tests/account-settings-contract.test.mjs',
    status: 'modified',
    sha: 'd418856c57eb6c6b47f65e568d4951fe38bf4fb2'
  }
]);

function deny(reason) {
  throw new Error('ACCOUNT_PREVIEW_DENIED: ' + reason);
}

function exactKeys(value, fields) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...fields].sort().join(',')
  );
}

function parseMarker(body, prefix, fields) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(prefix)
  ) {
    deny('unknown approval marker');
  }
  let value;
  try {
    value = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid JSON');
  }
  if (!exactKeys(value, fields)) deny('missing or unexpected approval fields');
  return value;
}

export function assertAccountDeletionPreviewAdmission({
  repository,
  issue,
  liveIssue,
  comment,
  main,
  pr,
  compare,
  ledgerPages
}) {
  if (
    repository !== REPO ||
    issue?.number !== 188 ||
    issue?.url !== ISSUE_URL ||
    issue?.state !== 'open' ||
    issue?.locked === true ||
    issue?.title !== TITLE ||
    issue?.pull_request ||
    issue?.user?.login !== OWNER ||
    !Number.isSafeInteger(issue?.id) ||
    issue.id <= 0 ||
    liveIssue?.id !== issue.id ||
    liveIssue?.number !== 188 ||
    liveIssue?.url !== ISSUE_URL ||
    liveIssue?.state !== 'open' ||
    liveIssue?.locked === true ||
    liveIssue?.title !== TITLE ||
    liveIssue?.pull_request ||
    liveIssue?.user?.login !== OWNER
  ) {
    deny('control issue is closed, locked, or not authenticated');
  }
  if (
    !Number.isSafeInteger(comment?.id) ||
    comment.id <= 0 ||
    comment?.user?.login !== OWNER ||
    comment?.author_association !== 'OWNER'
  ) {
    deny('not an OWNER-authored approval');
  }
  const approvalMode = comment.body.startsWith(FREE_PROOF_APPROVE)
    ? 'free-proof'
    : comment.body.startsWith(FREE_PREVIEW_APPROVE)
      ? 'free-preview'
      : 'standard';
  const approvalPrefix =
    approvalMode === 'free-proof'
      ? FREE_PROOF_APPROVE
      : approvalMode === 'free-preview'
        ? FREE_PREVIEW_APPROVE
        : PREFIX;
  const expectedScope =
    approvalMode === 'standard'
      ? 'account-deletion-preview'
      : approvalMode === 'free-preview'
        ? 'account-deletion-free-preview'
        : 'account-deletion-free-proof';
  const approved = parseMarker(comment.body, approvalPrefix, [
    'scope',
    'mainSha',
    'candidateSha',
    'confirmation',
    ...(approvalMode === 'free-proof' ? ['previewUrl'] : [])
  ]);
  if (
    approved.scope !== expectedScope ||
    approved.confirmation !== 'STAGING APPROVED' ||
    !SHA.test(approved.mainSha) ||
    !SHA.test(approved.candidateSha) ||
    approved.mainSha === approved.candidateSha ||
    main?.object?.sha !== approved.mainSha
  ) {
    deny('approval scope or exact current main mismatch');
  }
  if (approvalMode === 'free-proof') {
    let preview;
    try {
      preview = new URL(approved.previewUrl);
    } catch {
      deny('invalid exact free proof Preview URL');
    }
    if (
      preview.protocol !== 'https:' ||
      preview.hostname === 'novelrise.vercel.app' ||
      !preview.hostname.endsWith('.vercel.app') ||
      preview.username ||
      preview.password ||
      preview.origin !== approved.previewUrl
    ) {
      deny('free proof must target one exact non-Production Preview origin');
    }
  }

  if (
    pr?.number !== PR_NUMBER ||
    pr?.state !== 'open' ||
    pr?.draft !== true ||
    pr?.merged === true ||
    pr?.user?.login !== OWNER ||
    pr?.base?.ref !== 'main' ||
    pr?.base?.sha !== approved.mainSha ||
    pr?.head?.sha !== approved.candidateSha ||
    pr?.head?.ref !== PR_REF ||
    pr?.head?.repo?.full_name !== REPO
  ) {
    deny('candidate PR identity, base, or head drift');
  }

  if (
    compare?.status !== 'ahead' ||
    compare.behind_by !== 0 ||
    compare.base_commit?.sha !== approved.mainSha ||
    !Number.isSafeInteger(compare.total_commits) ||
    compare.total_commits < 1 ||
    compare.total_commits > 250 ||
    compare.ahead_by !== compare.total_commits ||
    !Array.isArray(compare.commits) ||
    compare.commits.length !== compare.total_commits ||
    compare.commits.at(-1)?.sha !== approved.candidateSha ||
    !Array.isArray(compare.files) ||
    compare.files.length !== REVIEWED_FILES.length
  ) {
    deny('candidate ancestry or changed-file count is unverified');
  }

  const actualFiles = new Map();
  for (const file of compare.files) {
    if (
      !file ||
      typeof file.filename !== 'string' ||
      actualFiles.has(file.filename)
    ) {
      deny('invalid or repeated candidate file');
    }
    actualFiles.set(file.filename, file);
  }
  for (const expected of REVIEWED_FILES) {
    const actual = actualFiles.get(expected.path);
    if (actual?.sha !== expected.sha || actual?.status !== expected.status) {
      deny('candidate file identity changed');
    }
  }

  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 50 ||
    !ledgerPages.every((page) => Array.isArray(page) && page.length <= 100) ||
    ledgerPages.at(-1).length >= 100
  ) {
    deny('approval ledger pagination incomplete');
  }
  for (const entry of ledgerPages.flat()) {
    if (!entry || typeof entry.body !== 'string')
      deny('malformed ledger entry');
    const match = LEDGER_PREFIXES.find(([prefix]) =>
      entry.body.startsWith(prefix)
    );
    if (!match) continue;
    const [marker, consumed] = match;
    const record = parseMarker(entry.body, marker, [
      'requestCommentId',
      'mainSha',
      'candidateSha',
      'runId',
      ...(consumed ? ['result'] : [])
    ]);
    if (String(record.requestCommentId) === String(comment.id)) {
      deny('approval already claimed or consumed');
    }
  }
  return Object.freeze({
    mainSha: approved.mainSha,
    candidateSha: approved.candidateSha,
    previewRef: PR_REF,
    requestCommentId: String(comment.id),
    ...(approvalMode === 'standard'
      ? {}
      : {
          approvalMode,
          ...(approvalMode === 'free-proof'
            ? { previewUrl: approved.previewUrl }
            : {})
        })
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const paths = process.argv.slice(2);
    if (paths.length !== 6) deny('six read-only evidence files required');
    const [event, liveIssue, main, pr, compare, ledgerPages] = paths.map(
      (path) => JSON.parse(readFileSync(path, 'utf8'))
    );
    const approved = assertAccountDeletionPreviewAdmission({
      repository: event.repository?.full_name,
      issue: event.issue,
      comment: event.comment,
      liveIssue,
      main,
      pr,
      compare,
      ledgerPages
    });
    process.stdout.write(JSON.stringify(approved) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
