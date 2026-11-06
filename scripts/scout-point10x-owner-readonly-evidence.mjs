// NOVELIGHT Point10x. Inactive read-only GitHub OWNER evidence verifier.
// No event listener, workflow, database adapter, approval claim, or side effects at import.
import { createHash } from 'node:crypto';
import { inspectMergedPrOnFreshMain } from './scout-point10x-merged-main-attestation.mjs';

export const GITHUB_OWNER_ID = 317436651;
export const GITHUB_OWNER_LOGIN = 'bingohooah888-ai';
export const GITHUB_REPO = 'bingohooah888-ai/novelrise';
export const ISSUE_NUMBER = 294;
export const SCOPE =
  'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly';
export const OPERATION = 'read-catalog-11-same-snapshot';
export const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
export const PRODUCTION_REF = 'fiepaguycecrredwrcwx';
export const SQL_SOURCE_SHA256 = Object.freeze([
  '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11',
  '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1'
]);
export const OWNER_MARKER = 'NOVELIGHT_POINT10X_READONLY_OWNER_V3';
export const OWNER_FIELDS = Object.freeze(
  [
    'evidencePolicyDigest',
    'executorDigest',
    'expiresAt',
    'headSha2762',
    'headSha2766',
    'headSha2767',
    'issueNumber',
    'mainSha',
    'manifestDigest',
    'mergeSha2766',
    'mergeSha2767',
    'operation',
    'ownerId',
    'repo',
    'runCount',
    'scope',
    'sqlSourceSha256',
    'stagingRef'
  ].sort()
);
const rec = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hex = (x, n) =>
  typeof x === 'string' && new RegExp('^[0-9a-f]{' + n + '}$', 'u').test(x);
const fail = (x) => {
  throw new Error('POINT10X_OWNER_HOLD:' + x);
};
export const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const canonical = (x) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(x)
        .sort()
        .map((key) => [key, x[key]])
    )
  );

export function parseExactOwnerScope(body) {
  if (
    typeof body !== 'string' ||
    body.length > 4096 ||
    !body.startsWith(OWNER_MARKER + '\n')
  )
    fail('MARKER_OR_SIZE');
  const text = body.slice(OWNER_MARKER.length + 1);
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    fail('JSON_INVALID');
  }
  if (
    !rec(obj) ||
    Object.keys(obj).sort().join('|') !== OWNER_FIELDS.join('|') ||
    canonical(obj) !== text
  )
    fail('NONCANONICAL_OR_DUPLICATE_FIELDS');
  return obj;
}

// Only trust this after *all* fields came freshly from authenticated GitHub REST
// in trusted-main code. Caller-provided snapshots never become an authorization.
export function inspectFreshGitHubOwnerEvidence({
  repo,
  issue,
  comment,
  allComments,
  trigger,
  mainRef,
  pr2762,
  pr2766,
  pr2767,
  compare2766,
  compare2767,
  mainRefAfter,
  now
} = {}) {
  if (
    !rec(repo) ||
    repo.full_name !== GITHUB_REPO ||
    repo.owner?.id !== GITHUB_OWNER_ID ||
    repo.owner?.login !== GITHUB_OWNER_LOGIN ||
    repo.owner?.type !== 'User' ||
    repo.default_branch !== 'main'
  )
    fail('REPO_OWNER');
  if (
    !rec(issue) ||
    issue.number !== ISSUE_NUMBER ||
    issue.state !== 'open' ||
    issue.pull_request ||
    !Number.isSafeInteger(issue.comments) ||
    issue.comments !== allComments?.length ||
    issue.repository_url !== 'https://api.github.com/repos/' + GITHUB_REPO
  )
    fail('ISSUE_IDENTITY');
  if (
    !rec(comment) ||
    !Number.isSafeInteger(comment.id) ||
    comment.id <= 0 ||
    comment.user?.id !== GITHUB_OWNER_ID ||
    comment.user?.login !== GITHUB_OWNER_LOGIN ||
    comment.user?.type !== 'User' ||
    comment.author_association !== 'OWNER' ||
    comment.issue_url !==
      'https://api.github.com/repos/' +
        GITHUB_REPO +
        '/issues/' +
        ISSUE_NUMBER ||
    comment.created_at !== comment.updated_at ||
    comment.deleted_at != null
  )
    fail('COMMENT_IDENTITY_OR_EDIT');
  if (
    !Array.isArray(allComments) ||
    allComments.length < 1 ||
    allComments.some(
      (c, i) =>
        !rec(c) ||
        !Number.isSafeInteger(c.id) ||
        (i > 0 && c.id <= allComments[i - 1].id)
    ) ||
    allComments.filter((c) => c.id === comment.id).length !== 1
  )
    fail('COMMENT_HISTORY_INCOMPLETE');
  if (
    !rec(trigger) ||
    trigger.eventName !== 'issue_comment' ||
    trigger.action !== 'created' ||
    trigger.commentId !== comment.id ||
    trigger.issueNumber !== ISSUE_NUMBER ||
    trigger.actorId !== GITHUB_OWNER_ID ||
    trigger.actorLogin !== GITHUB_OWNER_LOGIN ||
    trigger.repository !== GITHUB_REPO ||
    trigger.rerun !== false
  )
    fail('TRIGGER_UNTRUSTED');
  if (
    !rec(mainRef) ||
    !hex(mainRef.object?.sha, 40) ||
    !rec(pr2762) ||
    !hex(pr2762.head?.sha, 40) ||
    !rec(pr2766) ||
    !hex(pr2766.head?.sha, 40) ||
    !rec(pr2767) ||
    !hex(pr2767.head?.sha, 40) ||
    !rec(mainRefAfter) ||
    mainRefAfter.object?.sha !== mainRef.object.sha ||
    mainRef.ref !== 'refs/heads/main' ||
    mainRefAfter.ref !== 'refs/heads/main' ||
    pr2762.number !== 2762 ||
    pr2762.state !== 'open' ||
    pr2762.draft !== true
  )
    fail('FRESH_REFS_NOT_MATCHED');
  const obj = parseExactOwnerScope(comment.body);
  const fields = OWNER_FIELDS;
  if (
    !fields.every((k) => Object.hasOwn(obj, k)) ||
    obj.repo !== GITHUB_REPO ||
    obj.issueNumber !== ISSUE_NUMBER ||
    obj.ownerId !== GITHUB_OWNER_ID ||
    obj.scope !== SCOPE ||
    obj.operation !== OPERATION ||
    obj.stagingRef !== STAGING_REF ||
    obj.stagingRef === PRODUCTION_REF ||
    obj.runCount !== 1 ||
    obj.mainSha !== mainRef.object.sha ||
    obj.headSha2762 !== pr2762.head.sha ||
    obj.headSha2766 !== pr2766.head.sha ||
    obj.headSha2767 !== pr2767.head.sha ||
    !hex(obj.mergeSha2766, 40) ||
    !hex(obj.mergeSha2767, 40) ||
    !Array.isArray(obj.sqlSourceSha256) ||
    JSON.stringify(obj.sqlSourceSha256) !== JSON.stringify(SQL_SOURCE_SHA256) ||
    !hex(obj.manifestDigest, 64) ||
    !hex(obj.evidencePolicyDigest, 64) ||
    !hex(obj.executorDigest, 64)
  )
    fail('SCOPE_OR_DIGEST_DRIFT');
  const current = Date.parse(now),
    created = Date.parse(comment.created_at);
  const deadline = Date.parse(obj.expiresAt);
  if (
    ![current, created, deadline].every(Number.isFinite) ||
    current < created ||
    current - created > 15 * 60_000 ||
    deadline <= current ||
    deadline > created + 20 * 60_000
  )
    fail('OWNER_EVENT_EXPIRED_OR_REPLAYED');
  const dependency = inspectMergedPrOnFreshMain({
    pr: pr2766,
    comparison: compare2766,
    number: 2766,
    expectedHead: obj.headSha2766,
    expectedMerge: obj.mergeSha2766,
    mainSha: obj.mainSha,
    approvalCreatedAt: comment.created_at
  });
  const admissionCode = inspectMergedPrOnFreshMain({
    pr: pr2767,
    comparison: compare2767,
    number: 2767,
    expectedHead: obj.headSha2767,
    expectedMerge: obj.mergeSha2767,
    mainSha: obj.mainSha,
    approvalCreatedAt: comment.created_at
  });
  if (!dependency.presentOnMain || !admissionCode.presentOnMain)
    fail('MERGE_CHAIN_INCOMPLETE');
  // A passing synthetic ancestry shape NEVER grants GitHub-authenticated
  // OWNER authority or consumes the independent CONTROL one-use CAS.
  return Object.freeze({
    dependencyMergeSha: obj.mergeSha2766,
    admissionMergeSha: obj.mergeSha2767,
    status: 'NO_GO_GITHUB_EVIDENCE_SHAPE_ONLY',
    approvalDigest: sha256(comment.body),
    commentId: comment.id,
    freshMain: mainRef.object.sha,
    ownerIdentityMatches: true,
    ownerAuthenticatedForExecution: false,
    controlSpentConsumed: false,
    mayConnectStaging: false
  });
}

// Concrete GET-only GitHub evidence collector; never issues mutations. The
// built-in HTTPS fetch is used, not an arbitrary caller-supplied API URL.
// No call is performed by this PR, and its result alone is never a grant.
export async function collectGitHubOwnerEvidenceReadOnly({ token, commentId }) {
  if (
    typeof token !== 'string' ||
    token.length < 12 ||
    !Number.isSafeInteger(commentId) ||
    commentId <= 0
  )
    fail('FETCH_INPUT');
  const apiRoot = 'https://api.github.com/repos/' + GITHUB_REPO;
  const get = async (path) => {
    const response = await fetch(apiRoot + path, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) fail('GITHUB_GET_DENIED');
    return response.json();
  };
  const [repo, issue, comment, mainRef, pr2762, pr2766, pr2767] =
    await Promise.all([
      get(''),
      get('/issues/' + ISSUE_NUMBER),
      get('/issues/comments/' + commentId),
      get('/git/ref/heads/main'),
      get('/pulls/2762'),
      get('/pulls/2766'),
      get('/pulls/2767')
    ]);
  // GitHub can advertise merge_commit_sha before a merge happens.
  // Never compare or trust a prospective SHA unless the REST PR is merged.
  if (
    !mainRef?.object?.sha ||
    ![pr2766, pr2767].every(
      (pr) =>
        pr?.merged === true &&
        pr.state === 'closed' &&
        pr.draft === false &&
        /^[0-9a-f]{40}$/u.test(pr.merge_commit_sha || '')
    )
  )
    fail('MERGE_NOT_CONFIRMED');
  const compare = (sha) =>
    get('/compare/' + sha + '...' + mainRef.object.sha + '?per_page=1&page=1');
  const [compare2766, compare2767] = await Promise.all([
    compare(pr2766.merge_commit_sha),
    compare(pr2767.merge_commit_sha)
  ]);
  const allComments = [];
  let exhausted = false;
  for (let page = 1; page <= 20; page++) {
    const result = await get(
      '/issues/' + ISSUE_NUMBER + '/comments?per_page=100&page=' + page
    );
    if (!Array.isArray(result) || result.length > 100) fail('PAGE_INVALID');
    allComments.push(...result.map(({ id }) => ({ id })));
    if (result.length < 100) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) fail('PAGE_TRUNCATED');
  // Detect main movement during multi-page approval verification; no stale
  // or cross-ref reads can be converted into a permission.
  const mainRefAfter = await get('/git/ref/heads/main');
  if (mainRefAfter?.object?.sha !== mainRef.object.sha)
    fail('MAIN_MOVED_DURING_VERIFICATION');
  return {
    repo,
    issue,
    comment,
    mainRef,
    mainRefAfter,
    pr2762,
    pr2766,
    pr2767,
    compare2766,
    compare2767,
    allComments
  };
}
