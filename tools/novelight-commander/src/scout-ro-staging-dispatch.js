// Reuses the existing NLO OWNER GitHub Bridge; no new tokens or workflow.
// This adapter never runs from a timer and cannot bypass separate approval.
export const SCOUT_RO_DISPATCH = Object.freeze({
  owner: 'bingohooah888-ai',
  ownerId: 317436651,
  repo: 'bingohooah888-ai/novelrise',
  controlIssue: 1837,
  approvalIssue: 188,
  scope: 'scout-formal-reader-credential-staging-v1',
  stagingRef: 'wmlzjgvxgoyrovdhbqbg',
  previewBranch: 'feature/scout-formal-qualified-earnings-offline-20261116',
  confirmation: 'STAGING FORMAL RO APPROVED',
  workflow: 'scout-formal-staging-ro-provision.yml',
  workflowPath: '.github/workflows/scout-formal-staging-ro-provision.yml',
  workflowBlobSha: '80a85d589de43af4802422b221e59e4ca134161f',
  scriptPath: 'scripts/scout-formal-staging-ro-provision.mjs'
});
const C = SCOUT_RO_DISPATCH;
const base = '/repos/' + C.repo;
const approvalPrefix = 'NOVELIGHT_SCOUT_RO_STAGING_APPROVE ';
const claimPrefix = 'NOVELIGHT_SCOUT_RO_STAGING_DISPATCH_CLAIM ';
const requestIdPattern =
  /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/u;
const shaPattern = /^[a-f0-9]{40}$/u;
const keysMatch = (obj, keys) =>
  obj && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).sort().join(',') === [...keys].sort().join(',');

function hold(code) {
  throw Object.assign(new Error('SCOUT_RO_DISPATCH_HOLD:' + code), {
    safeCode: code
  });
}
function freshOwner(comment, nowMs, issueNumber) {
  if (
    comment?.user?.login !== C.owner ||
    comment?.user?.id !== C.ownerId ||
    comment?.author_association !== 'OWNER' ||
    comment?.issue_url !== 'https://api.github.com' +
      base + '/issues/' + issueNumber ||
    typeof comment?.created_at !== 'string' ||
    comment.created_at !== comment.updated_at
  ) return false;
  const age = nowMs - Date.parse(comment.created_at);
  return Number.isFinite(age) && age >= 0 && age <= 15 * 60 * 1000;
}

export function validateScoutRoDispatchRequest(request, source, nowMs) {
  if (
    request?.version !== 1 ||
    !requestIdPattern.test(String(request?.requestId || '')) ||
    request?.action !== 'scout_ro_staging_dispatch' ||
    !keysMatch(request?.args, [
      'mainSha', 'stagingRef', 'previewBranch', 'scope',
      'confirmation', 'scriptBlobSha', 'approvalCommentId'
    ])
  ) hold('REQUEST_SHAPE');
  const a = request.args;
  if (
    !shaPattern.test(String(a.mainSha || '')) ||
    !shaPattern.test(String(a.scriptBlobSha || '')) ||
    a.stagingRef !== C.stagingRef ||
    a.previewBranch !== C.previewBranch ||
    a.scope !== C.scope ||
    a.confirmation !== C.confirmation ||
    !Number.isSafeInteger(a.approvalCommentId) ||
    a.approvalCommentId < 1
  ) hold('REQUEST_SCOPE');
  if (!freshOwner(source, nowMs, C.controlIssue))
    hold('OWNER_REQUEST_UNVERIFIED');
  return Object.freeze({
    requestId: request.requestId,
    mainSha: a.mainSha,
    scriptBlobSha: a.scriptBlobSha,
    approvalCommentId: a.approvalCommentId
  });
}

function validateApproval(comment, request, nowMs) {
  if (
    !freshOwner(comment, nowMs, C.approvalIssue) ||
    comment?.id !== request.approvalCommentId ||
    !String(comment?.body || '').startsWith(approvalPrefix)
  ) hold('STAGING_APPROVAL_UNVERIFIED');
  let approval;
  try {
    approval = JSON.parse(comment.body.slice(approvalPrefix.length));
  } catch {
    hold('STAGING_APPROVAL_SHAPE');
  }
  if (
    !keysMatch(approval, [
      'requestId', 'mainSha', 'scriptBlobSha', 'scope',
      'stagingRef', 'previewBranch', 'confirmation'
    ]) ||
    approval.requestId !== request.requestId ||
    approval.mainSha !== request.mainSha ||
    approval.scriptBlobSha !== request.scriptBlobSha ||
    approval.scope !== C.scope ||
    approval.stagingRef !== C.stagingRef ||
    approval.previewBranch !== C.previewBranch ||
    approval.confirmation !== C.confirmation
  ) hold('STAGING_APPROVAL_MISMATCH');
  return true;
}

function checkClaims(comments, request) {
  if (!Array.isArray(comments) || comments.length >= 100)
    hold('LEDGER_INCOMPLETE');
  for (const comment of comments) {
    if (!String(comment?.body || '').startsWith(claimPrefix)) continue;
    let claim;
    try {
      claim = JSON.parse(comment.body.slice(claimPrefix.length));
    } catch {
      hold('LEDGER_INVALID');
    }
    if (
      !keysMatch(claim, [
        'requestId', 'mainSha', 'scope', 'stagingRef',
        'approvalCommentId'
      ])
    ) hold('LEDGER_INVALID');
    if (
      claim.scope === C.scope &&
      (claim.mainSha === request.mainSha ||
        claim.requestId === request.requestId ||
        claim.approvalCommentId === request.approvalCommentId)
    ) hold('ALREADY_CLAIMED');
  }
}

function checkRuns(payload, mainSha) {
  if (
    !Number.isSafeInteger(payload?.total_count) ||
    payload.total_count < 0 ||
    payload.total_count > 100 ||
    !Array.isArray(payload.workflow_runs) ||
    payload.workflow_runs.length !== payload.total_count
  ) hold('RUN_HISTORY_INCOMPLETE');
  if (payload.workflow_runs.some((run) =>
    run?.event === 'workflow_dispatch' && run.head_sha === mainSha
  )) hold('ALREADY_DISPATCHED');
}

async function safeCall(api, method, path, body) {
  try {
    return await api(method, path, body);
  } catch (error) {
    if (error?.safeCode) throw error;
    // No raw HTTP response body, error message, token or URL is returned.
    hold('GITHUB_API_UNAVAILABLE');
  }
}

export async function dispatchScoutRoStagingOnce({
  request, sourceComment, api, nowMs = Date.now()
}) {
  const r = validateScoutRoDispatchRequest(
    request, sourceComment, nowMs
  );
  if (typeof api !== 'function') hold('GITHUB_API_UNAVAILABLE');
  const identity = await safeCall(api, 'GET', '/user');
  if (identity?.login !== C.owner || identity?.id !== C.ownerId)
    hold('OWNER_TOKEN_UNVERIFIED');

  const currentMain = async () => {
    const response = await safeCall(
      api, 'GET', base + '/git/ref/heads/main'
    );
    if (response?.object?.sha !== r.mainSha)
      hold('MAIN_SHA_DRIFT');
  };
  await currentMain();

  const workflow = await safeCall(
    api, 'GET', base + '/actions/workflows/' + C.workflow
  );
  if (
    workflow?.name !==
      'NOVELIGHT Formal Reader Staging Credential Provision (OWNER only)' ||
    workflow?.path !== C.workflowPath ||
    workflow?.state !== 'active'
  ) hold('WORKFLOW_UNVERIFIED');
  for (const [path, sha] of [
    [C.workflowPath, C.workflowBlobSha],
    [C.scriptPath, r.scriptBlobSha]
  ]) {
    const file = await safeCall(
      api, 'GET', base + '/contents/' + path + '?ref=' + r.mainSha
    );
    if (file?.type !== 'file' || file?.sha !== sha)
      hold('SOURCE_SHA_DRIFT');
  }

  const issue = await safeCall(
    api, 'GET', base + '/issues/' + C.approvalIssue
  );
  if (
    issue?.state !== 'open' ||
    issue?.number !== C.approvalIssue ||
    issue?.user?.id !== C.ownerId ||
    issue?.user?.login !== C.owner ||
    issue?.pull_request
  ) hold('STAGING_LEDGER_UNVERIFIED');

  const approval = await safeCall(
    api, 'GET', base + '/issues/comments/' + r.approvalCommentId
  );
  validateApproval(approval, r, nowMs);
  const ledgerPath =
    base + '/issues/' + C.approvalIssue + '/comments?per_page=100';
  const comments = await safeCall(api, 'GET', ledgerPath);
  checkClaims(comments, r);
  if (!comments.some((c) =>
    c?.id === r.approvalCommentId && c?.body === approval.body
  )) hold('APPROVAL_NOT_IN_LEDGER');

  const runsPath = base + '/actions/workflows/' + C.workflow +
    '/runs?event=workflow_dispatch&per_page=100';
  checkRuns(await safeCall(api, 'GET', runsPath), r.mainSha);
  await currentMain();

  // Claim is durable and single-use. A timeout does NOT authorize retries.
  const claimBody = claimPrefix + JSON.stringify({
    requestId: r.requestId,
    mainSha: r.mainSha,
    scope: C.scope,
    stagingRef: C.stagingRef,
    approvalCommentId: r.approvalCommentId
  });
  const claim = await safeCall(
    api, 'POST',
    base + '/issues/' + C.approvalIssue + '/comments',
    { body: claimBody }
  );
  if (
    claim?.body !== claimBody ||
    claim?.user?.login !== C.owner ||
    claim?.user?.id !== C.ownerId ||
    claim?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(claim?.id)
  ) hold('CLAIM_UNVERIFIED');
  const after = await safeCall(api, 'GET', ledgerPath);
  if (!Array.isArray(after) || after.length >= 100)
    hold('LEDGER_INCOMPLETE');
  const same = after.filter((c) => {
    if (!String(c?.body || '').startsWith(claimPrefix)) return false;
    try {
      const value = JSON.parse(c.body.slice(claimPrefix.length));
      return value.mainSha === r.mainSha && value.scope === C.scope;
    } catch {
      hold('LEDGER_INVALID');
    }
  });
  if (same.length !== 1 || same[0]?.id !== claim.id)
    hold('DUPLICATE_CLAIM');

  await currentMain();
  checkRuns(await safeCall(api, 'GET', runsPath), r.mainSha);
  await safeCall(
    api, 'POST',
    base + '/actions/workflows/' + C.workflow + '/dispatches',
    {
      ref: 'main',
      inputs: {
        main_sha: r.mainSha,
        scope: C.scope,
        staging_ref: C.stagingRef,
        preview_branch: C.previewBranch,
        confirmation: C.confirmation
      }
    }
  );
  return Object.freeze({
    status: 'DISPATCH_ACCEPTED_STAGING_RESULT_UNVERIFIED',
    mainSha: r.mainSha,
    stagingRef: C.stagingRef,
    claimCommentId: claim.id,
    secretsExposed: false,
    productionMutation: false
  });
}
