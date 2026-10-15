// NOVELIGHT Stage 05: one-time explicit-owner release executor.
// Runs ONLY inside the authorized production GitHub Actions environment.
// Never run manually: requires independent owner and terms evidence from GitHub.
import { readFileSync } from 'node:fs';

import {
  buildAtomicRegistrationOpenSql
} from './november-contest-registration-open-plan.mjs';
import {
  inspectRegistrationApprovalEvidence
} from './november-contest-registration-evidence.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'fiepaguycecrredwrcwx';
const ISSUE = 2120;
const PREFIX = '/repos/' + REPO;
const CLAIMED = 'NOVELIGHT_CONTEST_REGISTRATION_OPEN_CLAIMED ';
const EXECUTED = 'NOVELIGHT_CONTEST_REGISTRATION_OPEN_EXECUTED ';
const FAILED = 'NOVELIGHT_CONTEST_REGISTRATION_OPEN_FAILED ';

function stop(reason) {
  throw new Error('STEP05_RELEASE_BLOCKED: ' + reason);
}

export function validateReadOnlyRows(rows, phase, approvalCommentId) {
  if (!Array.isArray(rows) || rows.length !== 1 ||
      typeof rows[0] !== 'object' || rows[0] === null) {
    stop('unexpected DB read-only response');
  }
  const row = rows[0];
  if (phase === 'before') {
    if (row.status !== 'draft' || row.public_visible !== false ||
        row.terms_version !== '' || row.terms_url !== '' ||
        Number(row.entry_count) !== 0) {
      stop('Production is not a private empty draft');
    }
  } else if (phase === 'after') {
    if (row.status !== 'registration' || row.public_visible !== true ||
        row.terms_version !== 'november-2026-v1' ||
        row.terms_url !== 'https://novelight.jp/contest-terms' ||
        Number(row.audit_count) !== 1 ||
        !Number.isSafeInteger(approvalCommentId)) {
      stop('Production after-state or audit row mismatch');
    }
  } else {
    stop('unknown release audit phase');
  }
  return true;
}

export function checkLedgerForOneTimeUse(comments, approvalId) {
  if (!Array.isArray(comments) || comments.length >= 500 ||
      !Number.isSafeInteger(approvalId)) {
    stop('bounded ledger evidence missing');
  }
  for (const comment of comments) {
    const b = comment?.body;
    if (typeof b !== 'string') continue;
    const pre = [CLAIMED, EXECUTED, FAILED].find((prefix) => b.startsWith(prefix));
    if (!pre) continue;
    let data;
    try {
      data = JSON.parse(b.slice(pre.length));
    } catch {
      stop('malformed ledger record: manual review required');
    }
    // Any other released contest must block a new opening as well.
    if (data?.contestKey === 'novelight-november-2026') {
      stop('an earlier release claim requires reconciliation');
    }
    if (data?.approvalCommentId === approvalId) {
      stop('approval already claimed or consumed');
    }
  }
}

const BEFORE_SQL = `select c.status, c.public_visible, c.terms_version, c.terms_url,
  (select count(*)::integer from public.novelight_contest_entries e
    where e.contest_id=c.id) as entry_count
from public.novelight_contests c
where c.contest_key='novelight-november-2026';`;

function afterSql(approvalCommentId) {
  if (!Number.isSafeInteger(approvalCommentId) || approvalCommentId <= 0) {
    stop('invalid approval ID');
  }
  return `select c.status, c.public_visible, c.terms_version, c.terms_url,
    (select count(*)::integer from public.novelight_contest_review_audit a
      where a.contest_id=c.id and a.action='registration_open'
      and a.evidence_summary->>'approval_comment'=
        'github-comment-${approvalCommentId}') as audit_count
  from public.novelight_contests c
  where c.contest_key='novelight-november-2026';`;
}

export async function performRegistrationRelease({
  event, checkoutSha, now, github, supabase
}) {
  if (typeof github?.get !== 'function' ||
      typeof github?.postComment !== 'function' ||
      typeof supabase?.query !== 'function' ||
      typeof checkoutSha !== 'string') {
    stop('trusted release environment missing');
  }
  const approval = await inspectRegistrationApprovalEvidence({
    event,
    checkoutSha,
    now,
    fetchJson: github.get
  });
  if (!approval.verifiedFromGithubApi ||
      approval.productionMutationPerformed !== false ||
      approval.registrationOpened !== false) {
    stop('GitHub evidence verification not completed');
  }

  // Compare live main again at the mutation boundary.
  const live = await github.get(PREFIX + '/git/ref/heads/main');
  if (live?.object?.sha !== approval.mainSha) {
    stop('main advanced after approval verification');
  }
  const ledger = [];
  for (let page = 1; page <= 5; page++) {
    const rows = await github.get(
      PREFIX + '/issues/' + ISSUE + '/comments?per_page=100&page=' + page
    );
    if (!Array.isArray(rows) || ledger.length + rows.length > 499) {
      stop('ledger pagination exceeded fixed safe bound');
    }
    ledger.push(...rows);
    if (rows.length < 100) break;
    if (page === 5) stop('ledger continuation limit reached');
  }
  checkLedgerForOneTimeUse(ledger, approval.commentId);

  // The Production endpoint may change; only accept an exact row shape.
  const before = await supabase.query(BEFORE_SQL, true);
  validateReadOnlyRows(before, 'before', approval.commentId);
  const claim = {
    operation: 'november-contest-registration-open',
    contestKey: 'novelight-november-2026',
    approvalCommentId: approval.commentId,
    mainSha: approval.mainSha,
    challenge: approval.challenge
  };
  // From here, do not auto-retry: a partial or ambiguous response needs
  // manual reconciliation before another independently signed approval.
  await github.postComment(ISSUE, CLAIMED + JSON.stringify(claim));
  let phase = 'fresh_main_check';
  try {
    const beforeMutation = await github.get(PREFIX + '/git/ref/heads/main');
    if (beforeMutation?.object?.sha !== approval.mainSha) {
      stop('main advanced after claim; no SQL executed');
    }
    phase = 'production_mutation_unknown';
    // The SQL is a single bounded transaction, with no cron or award changes.
    await supabase.query(buildAtomicRegistrationOpenSql(approval), false);
    phase = 'postcheck';
    const after = await supabase.query(afterSql(approval.commentId), true);
    validateReadOnlyRows(after, 'after', approval.commentId);
    await github.postComment(
      ISSUE,
      EXECUTED + JSON.stringify({ ...claim, afterState: 'verified' })
    );
    return {
      status: 'REGISTRATION_OPEN_VERIFIED',
      approvalCommentId: approval.commentId,
      mainSha: approval.mainSha
    };
  } catch (err) {
    await github.postComment(
      ISSUE,
      FAILED + JSON.stringify({
        ...claim,
        failurePhase: phase,
        requiresManualReconciliation: true
      })
    );
    throw err;
  }
}

async function runCli() {
  if (process.env.GITHUB_EVENT_NAME !== 'issue_comment' ||
      process.env.GITHUB_REPOSITORY !== REPO ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      !process.env.GITHUB_EVENT_PATH ||
      !process.env.GITHUB_SHA ||
      !process.env.GITHUB_TOKEN ||
      !process.env.SUPABASE_ACCESS_TOKEN ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.NOVELIGHT_CONTEST_RELEASE_SCOPE !==
        'OWNER_APPROVED_REGISTRATION_OPEN_ONLY') {
    stop('GitHub Production release identity or credentials not verified');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const apiHeaders = {
    Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const request = async (url, options = {}) => {
    const res = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) stop('trusted API unavailable (HTTP ' + res.status + ')');
    return res.json();
  };
  const github = {
    get: (path) => request('https://api.github.com' + path, {
      headers: apiHeaders
    }),
    postComment: (issue, body) => request(
      'https://api.github.com' + PREFIX + '/issues/' + issue + '/comments',
      {
        method: 'POST',
        headers: { ...apiHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      }
    )
  };
  const supabase = {
    query: (sql, readOnly) => request(
      'https://api.supabase.com/v1/projects/' + PROJECT +
        '/database/query' + (readOnly ? '/read-only' : ''),
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      }
    )
  };
  const result = await performRegistrationRelease({
    event,
    checkoutSha: process.env.GITHUB_SHA,
    now: new Date().toISOString(),
    github,
    supabase
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1]?.endsWith('/november-contest-registration-release.mjs')) {
  runCli().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
