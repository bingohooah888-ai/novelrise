// 02-07-05 dormant GitHub Issue #294 REST reader. GET only.
// Requires a separately approved, least-privilege issues:read token.
// Never invoked by any workflow, HTTP endpoint or import side effect.
import { inspect020705ReadOnlyOwnerLedger } from './owner-ledger-readonly-verifier.mjs';

const API = 'https://api.github.com/repos/bingohooah888-ai/novelrise';
const ISSUE_URL = API + '/issues/294';
const COMMENTS_URL = ISSUE_URL + '/comments?per_page=100&page=';
const MAX_PAGES = 100;
const HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
});

function deny() {
  throw new Error('AI_020705_READONLY_GITHUB_API_DENIED');
}

export async function read020705OwnerLedgerFromGithub({
  token,
  scope,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (
    typeof token !== 'string' ||
    token.length < 12 || token.length > 4096 ||
    typeof fetchImpl !== 'function' ||
    typeof now !== 'function' ||
    !scope || typeof scope !== 'object'
  ) deny();
  let snapshot;
  try {
    const authHeaders = {
      ...HEADERS,
      Authorization: 'Bearer ' + token
    };
    async function getJson(url) {
      // Fixed host and exact allowlisted path; never use a URL from
      // a GitHub comment or redirect into a different host.
      if (url !== ISSUE_URL &&
          !/^https:\/\/api\.github\.com\/repos\/bingohooah888-ai\/novelrise\/issues\/294\/comments\?per_page=100&page=[1-9]\d*$/u.test(url)) {
        deny();
      }
      const response = await fetchImpl(url, {
        method: 'GET', headers: authHeaders, redirect: 'error'
      });
      if (response?.status !== 200 ||
          typeof response.json !== 'function') deny();
      return response.json();
    }

    const issue = await getJson(ISSUE_URL);
    if (
      issue?.number !== 294 ||
      issue?.title !== '[Staging Control] Supabase migration sync' ||
      issue?.state !== 'open' ||
      issue?.pull_request != null ||
      !Number.isSafeInteger(issue.comments) ||
      issue.comments < 1 || issue.comments > 10000
    ) deny();
    const pageCount = Math.ceil(issue.comments / 100);
    if (pageCount < 1 || pageCount > MAX_PAGES) deny();
    const pages = [];
    for (let i = 1; i <= pageCount; i++) {
      const comments = await getJson(COMMENTS_URL + i);
      if (!Array.isArray(comments)) deny();
      pages.push({number: i, comments});
    }
    const recheckedIssue = await getJson(ISSUE_URL);
    if (recheckedIssue?.number !== 294 ||
        recheckedIssue?.title !== issue.title ||
        recheckedIssue?.state !== 'open' ||
        recheckedIssue?.comments !== issue.comments) deny();
    snapshot = {
      repository: 'bingohooah888-ai/novelrise',
      issue,
      commentsCountAfterFetch: recheckedIssue.comments,
      observedAtMs: now(),
      pages
    };
  } catch {
    // Never leak authorization headers, raw GitHub response or personal
    // data to Actions, PR comments or user-facing error messages.
    deny();
  }
  return inspect020705ReadOnlyOwnerLedger({
    snapshot, scope, now: now()
  });
}
