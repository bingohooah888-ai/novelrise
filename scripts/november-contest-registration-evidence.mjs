// Read-only GitHub evidence check for the November contest.
// No database access, SQL execution, issue writes, or approval claims.
import { readFileSync } from 'node:fs';

import {
  CONTEST_REGISTRATION_PREFIX,
  CONTROL_ISSUE,
  TERMS_URL,
  TERMS_VERSION,
  verifyRegistrationOpenApproval
} from './november-contest-registration-open-plan.mjs';

export const TERMS_ADOPTION_PREFIX = 'NOVELIGHT_CONTEST_TERMS_ADOPTED ';
const OWNER = 'bingohooah888-ai';
const REPO = 'bingohooah888-ai/novelrise';
const TERMS_PATH = 'api/_lib/contest-terms-template.js';
const SHA_RE = /^[0-9a-f]{40}$/;

function fail(reason) {
  throw new Error('STEP05_EVIDENCE_BLOCKED: ' + reason);
}

function exactKeys(object, names) {
  return object !== null &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    Object.keys(object).length === names.length &&
    names.every((name) => Object.hasOwn(object, name));
}

function parseAdoption(comment, termsSourceSha, approvalTime) {
  if (comment?.user?.login !== OWNER ||
      comment?.author_association !== 'OWNER' ||
      comment?.issue_url !==
        'https://api.github.com/repos/' + REPO + '/issues/' + CONTROL_ISSUE ||
      typeof comment?.body !== 'string' ||
      !comment.body.startsWith(TERMS_ADOPTION_PREFIX)) {
    fail('independent owner adoption comment not verified');
  }
  let adoption;
  try {
    adoption = JSON.parse(comment.body.slice(TERMS_ADOPTION_PREFIX.length));
  } catch {
    fail('invalid adoption JSON');
  }
  if (!exactKeys(adoption, [
    'operation', 'confirmation', 'termsVersion', 'termsUrl', 'termsSourceSha'
  ]) ||
      adoption.operation !== 'adopt-november-contest-terms' ||
      adoption.confirmation !== 'CHAT_CONTEST_TERMS_ADOPTED' ||
      adoption.termsVersion !== TERMS_VERSION ||
      adoption.termsUrl !== TERMS_URL ||
      adoption.termsSourceSha !== termsSourceSha) {
    fail('adoption does not match exact official terms');
  }
  const adoptedAt = Date.parse(comment.created_at);
  if (!Number.isFinite(adoptedAt) ||
      adoptedAt > approvalTime ||
      !Number.isSafeInteger(comment.id) ||
      comment.id <= 0) {
    fail('adoption chronology invalid');
  }
  return {
    ownerVerified: true,
    commentId: comment.id,
    termsSourceSha,
    termsVersion: TERMS_VERSION,
    termsUrl: TERMS_URL
  };
}

export async function inspectRegistrationApprovalEvidence({
  event,
  checkoutSha,
  fetchJson,
  now
}) {
  if (typeof fetchJson !== 'function' ||
      typeof now !== 'string' ||
      !SHA_RE.test(checkoutSha)) {
    fail('invalid trusted audit runtime');
  }
  if (event?.repository?.full_name !== REPO ||
      event?.issue?.number !== CONTROL_ISSUE ||
      event?.issue?.pull_request != null ||
      !Number.isSafeInteger(event?.comment?.id) ||
      event.comment.id <= 0) {
    fail('wrong event repository, issue, or comment');
  }
  const commentId = event.comment.id;
  const prefix = '/repos/' + REPO;
  // The independently fetched comment and live ref are authoritative;
  // never trust author identities or content supplied inside approval JSON.
  const [ref, comment] = await Promise.all([
    fetchJson(prefix + '/git/ref/heads/main'),
    fetchJson(prefix + '/issues/comments/' + commentId)
  ]);
  const mainSha = ref?.object?.sha;
  if (!SHA_RE.test(mainSha) || mainSha !== checkoutSha) {
    fail('checkout SHA differs from latest main');
  }
  if (comment?.id !== commentId ||
      comment?.user?.login !== OWNER ||
      comment?.author_association !== 'OWNER' ||
      comment?.issue_url !==
        'https://api.github.com/repos/' + REPO + '/issues/' + CONTROL_ISSUE ||
      typeof comment?.body !== 'string' ||
      !comment.body.startsWith(CONTEST_REGISTRATION_PREFIX)) {
    fail('original owner approval cannot be authenticated');
  }
  let payload;
  try {
    payload = JSON.parse(
      comment.body.slice(CONTEST_REGISTRATION_PREFIX.length)
    );
  } catch {
    fail('malformed owner approval');
  }
  if (!Number.isSafeInteger(payload?.termsAdoptionCommentId) ||
      payload.termsAdoptionCommentId <= 0 ||
      payload.termsAdoptionCommentId === commentId) {
    fail('independent adoption comment is missing');
  }
  const [terms, adopted] = await Promise.all([
    fetchJson(
      prefix + '/contents/' + TERMS_PATH + '?ref=' + encodeURIComponent(mainSha)
    ),
    fetchJson(prefix + '/issues/comments/' + payload.termsAdoptionCommentId)
  ]);
  if (!SHA_RE.test(terms?.sha) ||
      terms?.path !== TERMS_PATH ||
      terms?.type !== 'file') {
    fail('official terms source did not resolve');
  }
  const approvalTime = Date.parse(comment.created_at);
  const auditTime = Date.parse(now);
  if (!Number.isFinite(approvalTime) ||
      !Number.isFinite(auditTime) ||
      approvalTime > auditTime ||
      approvalTime - Date.parse(adopted?.created_at) < 0) {
    fail('GitHub comment event chronology invalid');
  }
  const result = verifyRegistrationOpenApproval({
    repository: REPO,
    issueNumber: CONTROL_ISSUE,
    commentAuthor: comment.user.login,
    authorAssociation: comment.author_association,
    commentBody: comment.body,
    commentId,
    currentMainSha: mainSha,
    currentTermsSourceSha: terms.sha,
    termsAdoptionEvidence: parseAdoption(
      adopted,
      terms.sha,
      approvalTime
    ),
    now
  });
  return Object.freeze({
    ...result,
    verifiedFromGithubApi: true,
    mode: 'READ_ONLY_EVIDENCE_AUDIT',
    registrationOpened: false,
    databaseTouched: false
  });
}

async function runCli() {
  // GitHub Actions event context is trusted only after independent REST checks.
  if (process.env.GITHUB_EVENT_NAME !== 'issue_comment' ||
      !process.env.GITHUB_EVENT_PATH ||
      !process.env.GITHUB_SHA ||
      !process.env.GITHUB_TOKEN) {
    fail('GitHub Actions evidence-only environment required');
  }
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
  );
  const apiBase = 'https://api.github.com';
  async function fetchJson(path) {
    const res = await fetch(apiBase + path, {
      headers: {
        Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) fail('GitHub REST evidence lookup failed: ' + res.status);
    return res.json();
  }
  const result = await inspectRegistrationApprovalEvidence({
    event,
    checkoutSha: process.env.GITHUB_SHA,
    fetchJson,
    now: new Date().toISOString()
  });
  // Do not print a bank account, identity document or raw approval payload.
  console.log(JSON.stringify({
    status: 'READ_ONLY_EVIDENCE_VERIFIED_NO_RELEASE',
    requestId: result.requestId,
    mainSha: result.mainSha,
    approvalCommentId: result.commentId,
    adoptionCommentId: result.termsAdoptionCommentId,
    databaseTouched: false,
    registrationOpened: false
  }));
}

// The script's CLI never exposes a Production-mutation path.
if (process.argv[1]?.endsWith('/november-contest-registration-evidence.mjs')) {
  runCli().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
