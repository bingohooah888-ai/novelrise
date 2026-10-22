// Stage 12 release executor. Called only from the dedicated OWNER-controlled
// production workflow after independently signed START approval.
// No automatic retries. No email, bank, cron, or Vercel environment changes.
import { readFileSync } from 'node:fs';
import {
  verifyContestStartApproval,
  buildContestStartSql
} from './november-contest-start-plan.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const ISSUE = 2120;
const PROJECT = 'fiepaguycecrredwrcwx';
const API = '/repos/' + REPO;
const PREFIXES = [
  'NOVELIGHT_CONTEST_START_CLAIMED ',
  'NOVELIGHT_CONTEST_START_EXECUTED ',
  'NOVELIGHT_CONTEST_START_FAILED '
];
function block(message) { throw new Error('STEP12_RELEASE_BLOCKED: ' + message); }

export function validateStartState(rows, phase) {
  if (!Array.isArray(rows) || rows.length !== 1 ||
      !rows[0] || typeof rows[0] !== 'object') {
    block('invalid Production read-only response');
  }
  const r = rows[0];
  if (phase === 'before') {
    if (r.status !== 'registration' || r.public_visible !== true ||
        r.terms_version !== 'december-2026-v2' ||
        r.terms_url !== 'https://novelight.jp/contest-terms' ||
        (!Number.isSafeInteger(Number(r.registered_entries)) ||
         Number(r.registered_entries) < 1) ||
        Number(r.registration_audits) !== 1 ||
        Number(r.read_events) !== 0 || Number(r.rank_snapshots) !== 0 ||
        Number(r.awards) !== 0) {
      block('Production is not a clean, open registration');
    }
  } else if (phase === 'after') {
    if (r.status !== 'active' || r.public_visible !== true ||
        Number(r.start_audits) !== 1) {
      block('start postcheck or audit proof failed');
    }
  } else {
    block('unknown start phase');
  }
  return true;
}

export function assertUnclaimedStart(comments) {
  if (!Array.isArray(comments) || comments.length >= 500) {
    block('bounded ledger evidence unavailable');
  }
  for (const row of comments) {
    const body = row?.body;
    if (typeof body !== 'string') continue;
    for (const prefix of PREFIXES) {
      if (!body.startsWith(prefix)) continue;
      let record;
      try { record = JSON.parse(body.slice(prefix.length)); }
      catch { block('malformed start ledger requires manual review'); }
      if (record.contestKey === 'novelight-november-2026') {
        block('old start claim/attempt requires manual reconciliation');
      }
    }
  }
}

const BEFORE = `select c.status,c.public_visible,c.terms_version,c.terms_url,
 (select count(*)::integer from public.novelight_contest_entries e
    where e.contest_id=c.id and e.status='entered') as registered_entries,
 (select count(*)::integer from public.novelight_contest_review_audit a
    where a.contest_id=c.id and a.action='registration_open') as registration_audits,
 (select count(*)::integer from public.novelight_contest_read_events e
    where e.contest_id=c.id) as read_events,
 (select count(*)::integer from public.novelight_contest_rank_snapshots s
    where s.contest_id=c.id) as rank_snapshots,
 (select count(*)::integer from public.novelight_contest_awards a
    where a.contest_id=c.id) as awards
 from public.novelight_contests c where c.contest_key='novelight-november-2026';`;

function afterQuery(commentId) {
  if (!Number.isSafeInteger(commentId) || commentId <= 0) block('invalid comment');
  return `select c.status,c.public_visible,
    (select count(*)::integer from public.novelight_contest_review_audit a
     where a.contest_id=c.id and a.action='contest_start'
       and a.evidence_summary->>'approval_comment'='github-comment-${commentId}'
    ) as start_audits
    from public.novelight_contests c
    where c.contest_key='novelight-november-2026';`;
}

export async function performContestStart({ event, checkoutSha, now, github, supabase }) {
  if (!event?.comment?.id || event.issue?.number !== ISSUE ||
      event.repository?.full_name !== REPO ||
      typeof github?.get !== 'function' ||
      typeof github?.postComment !== 'function' ||
      typeof supabase?.query !== 'function') {
    block('untrusted execution environment');
  }
  const id = event.comment.id;
  const raw = await github.get(API + '/issues/comments/' + id);
  const live = await github.get(API + '/git/ref/heads/main');
  const approved = verifyContestStartApproval({
    repository: REPO,
    issueNumber: ISSUE,
    commentAuthor: raw.user?.login,
    authorAssociation: raw.author_association,
    commentBody: raw.body,
    commentId: raw.id,
    currentMainSha: live?.object?.sha,
    now
  });
  if (approved.mainSha !== checkoutSha ||
      raw.issue_url !== 'https://api.github.com' + API + '/issues/' + ISSUE) {
    block('approval comment identity or checked-out main mismatch');
  }
  const ledger = [];
  for (let page = 1; page <= 5; page++) {
    const rows = await github.get(
      API + '/issues/' + ISSUE + '/comments?per_page=100&page=' + page
    );
    if (!Array.isArray(rows) || ledger.length + rows.length > 499) {
      block('untrusted start ledger pagination');
    }
    ledger.push(...rows);
    if (rows.length < 100) break;
    if (page === 5) block('unbounded ledger page');
  }
  assertUnclaimedStart(ledger);
  validateStartState(await supabase.query(BEFORE, true), 'before');
  const claim = {
    operation: 'start-december-contest',
    contestKey: 'novelight-november-2026',
    approvalCommentId: approved.commentId,
    mainSha: approved.mainSha,
    challenge: approved.challenge
  };
  await github.postComment(ISSUE, PREFIXES[0] + JSON.stringify(claim));
  let phase = 'before_sql';
  try {
    const again = await github.get(API + '/git/ref/heads/main');
    if (again?.object?.sha !== approved.mainSha) block('main changed after claim');
    phase = 'sql_result_ambiguous';
    await supabase.query(buildContestStartSql(approved), false);
    phase = 'postcheck';
    validateStartState(await supabase.query(afterQuery(id), true), 'after');
    await github.postComment(ISSUE, PREFIXES[1] + JSON.stringify(claim));
    return { status: 'CONTEST_START_VERIFIED', approvalCommentId: id };
  } catch (error) {
    await github.postComment(ISSUE, PREFIXES[2] + JSON.stringify({
      ...claim, failurePhase: phase, manualReconciliationRequired: true
    }));
    throw error;
  }
}

async function cli() {
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_EVENT_NAME !== 'issue_comment' ||
      process.env.GITHUB_REPOSITORY !== REPO ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.NOVELIGHT_CONTEST_RELEASE_SCOPE !== 'OWNER_APPROVED_START_ONLY' ||
      !process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_SHA ||
      !process.env.GITHUB_TOKEN || !process.env.SUPABASE_ACCESS_TOKEN) {
    block('dedicated Production workflow identity missing');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const headers = {
    Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  async function request(url, options={}) {
    const r = await fetch(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) block('trusted API HTTP ' + r.status);
    return r.json();
  }
  const github = {
    get: path => request('https://api.github.com' + path, { headers }),
    postComment: (issue,body) => request(
      'https://api.github.com' + API + '/issues/' + issue + '/comments',
      { method:'POST', headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({body}) }
    )
  };
  const supabase = {
    query: (query, readOnly) => request(
      'https://api.supabase.com/v1/projects/' + PROJECT +
        '/database/query' + (readOnly ? '/read-only' : ''),
      { method:'POST',
        headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,
          'Content-Type':'application/json'},
        body:JSON.stringify({query}) }
    )
  };
  const result = await performContestStart({
    event, checkoutSha:process.env.GITHUB_SHA, now:new Date().toISOString(),
    github,supabase
  });
  console.log(JSON.stringify(result));
}
if (process.argv[1]?.endsWith('/november-contest-start-release.mjs')) {
  cli().catch(e => { console.error(String(e));process.exitCode=1; });
}
