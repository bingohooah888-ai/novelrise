// NLO Point10x Stage 3.8: owner-only, single-use, Staging read-only dispatch.
// No autonomous runs. Never consume a prior chat approval or read any secret value.
export const POINT10X_STAGE38 = Object.freeze({
  owner: 'bingohooah888-ai',
  ownerId: 317436651,
  repo: 'bingohooah888-ai/novelrise',
  controlIssue: 1837,
  stagingApprovalIssue: 188,
  stagingRef: 'wmlzjgvxgoyrovdhbqbg',
  scope: 'point10x-stage38-staging-identity-readonly-v1',
  confirmation: 'STAGING READONLY IDENTITY APPROVED',
  approvalConfirmation: 'STAGING APPROVED',
  workflow: 'scout-point10x-staging-identity-readonly.yml',
  workflowPath:
    '.github/workflows/scout-point10x-staging-identity-readonly.yml',
  workflowBlobSha: 'e8a75ba201311f08d72c5ef61243361d8512211f',
  diagnosticPath: 'scripts/scout-point10x-staging-identity-readonly.mjs',
  diagnosticBlobSha: '612d0418f324233cd7e0e2918929add8cd2f8574'
});
const C = POINT10X_STAGE38;
const base = '/repos/' + C.repo;
const approvalPrefix = 'NOVELIGHT_STAGING_APPROVE ';
const claimPrefix = 'NOVELIGHT_POINT10X_STAGE38_DISPATCH_CLAIM ';
const hex40 = /^[a-f0-9]{40}$/u;
const requestIdPattern =
  /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/u;
const keysMatch = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function point10xDispatchHold(code) {
  return Object.assign(new Error('POINT10X_STAGE38_DISPATCH_HOLD:' + code), {
    safeCode: code
  });
}
function hold(code) {
  throw point10xDispatchHold(code);
}

function fresh(comment, nowMs) {
  if (
    !comment ||
    typeof comment.created_at !== 'string' ||
    comment.created_at !== comment.updated_at
  )
    return false;
  const ts = Date.parse(comment.created_at);
  return Number.isFinite(ts) && nowMs >= ts && nowMs - ts <= 15 * 60 * 1000;
}
function ownerComment(comment, nowMs) {
  return (
    comment?.user?.login === C.owner &&
    comment?.user?.id === C.ownerId &&
    comment?.author_association === 'OWNER' &&
    fresh(comment, nowMs)
  );
}

export function validatePoint10xDispatchRequest(
  request,
  comment,
  nowMs = Date.now()
) {
  if (
    !requestIdPattern.test(String(request?.requestId || '')) ||
    request?.action !== 'point10x_stage38_dispatch' ||
    !keysMatch(request?.args, [
      'mainSha',
      'scope',
      'stagingRef',
      'confirmation',
      'approvalCommentId'
    ])
  )
    hold('REQUEST_SHAPE');
  const args = request.args;
  if (
    !hex40.test(String(args.mainSha || '')) ||
    args.scope !== C.scope ||
    args.stagingRef !== C.stagingRef ||
    args.confirmation !== C.confirmation ||
    !Number.isSafeInteger(args.approvalCommentId) ||
    args.approvalCommentId < 1
  )
    hold('REQUEST_SCOPE');
  if (
    !ownerComment(comment, nowMs) ||
    !String(comment?.issue_url || '').endsWith('/issues/' + C.controlIssue)
  ) {
    hold('OWNER_REQUEST_UNVERIFIED');
  }
  return Object.freeze({
    requestId: request.requestId,
    mainSha: args.mainSha,
    approvalCommentId: args.approvalCommentId
  });
}

export function validatePoint10xApproval(comment, request, nowMs = Date.now()) {
  if (
    !ownerComment(comment, nowMs) ||
    Number(comment?.id) !== request.approvalCommentId ||
    comment?.issue_url !==
      'https://api.github.com' + base + '/issues/' + C.stagingApprovalIssue ||
    !String(comment?.body || '').startsWith(approvalPrefix)
  ) {
    hold('STAGING_APPROVAL_UNVERIFIED');
  }
  let value;
  try {
    value = JSON.parse(comment.body.slice(approvalPrefix.length));
  } catch {
    hold('STAGING_APPROVAL_SHAPE');
  }
  if (
    !keysMatch(value, [
      'requestId',
      'mainSha',
      'scope',
      'stagingRef',
      'confirmation'
    ]) ||
    value.requestId !== request.requestId ||
    value.mainSha !== request.mainSha ||
    value.scope !== C.scope ||
    value.stagingRef !== C.stagingRef ||
    value.confirmation !== C.approvalConfirmation
  ) {
    hold('STAGING_APPROVAL_MISMATCH');
  }
  return true;
}

function checkClaimLedger(comments, request) {
  if (!Array.isArray(comments) || comments.length >= 100)
    hold('LEDGER_CAPACITY');
  for (const comment of comments) {
    if (!String(comment?.body || '').startsWith(claimPrefix)) continue;
    let value;
    try {
      value = JSON.parse(comment.body.slice(claimPrefix.length));
    } catch {
      hold('LEDGER_INVALID');
    }
    if (
      !keysMatch(value, [
        'requestId',
        'mainSha',
        'scope',
        'stagingRef',
        'approvalCommentId'
      ])
    )
      hold('LEDGER_INVALID');
    if (
      value.scope === C.scope &&
      (value.mainSha === request.mainSha ||
        value.approvalCommentId === request.approvalCommentId ||
        value.requestId === request.requestId)
    ) {
      hold('ALREADY_CLAIMED');
    }
  }
}
function strictRunList(payload, request) {
  if (
    !Number.isSafeInteger(payload?.total_count) ||
    payload.total_count < 0 ||
    payload.total_count > 100 ||
    !Array.isArray(payload.workflow_runs) ||
    payload.workflow_runs.length !== payload.total_count
  ) {
    hold('RUN_HISTORY_INCOMPLETE');
  }
  if (
    payload.workflow_runs.some(
      (run) =>
        run?.event === 'workflow_dispatch' && run?.head_sha === request.mainSha
    )
  ) {
    hold('ALREADY_DISPATCHED');
  }
}

async function call(api, method, path, body) {
  try {
    return await api(method, path, body);
  } catch (error) {
    if (error?.safeCode) throw error;
    // Never return API error bodies, credentials, URLs or headers.
    const message = error instanceof Error ? error.message : '';
    hold(
      /(?:API\s+40[13]|HTTP\s+40[13])/u.test(message)
        ? 'GITHUB_PERMISSION_DENIED'
        : 'GITHUB_API_UNAVAILABLE'
    );
  }
}

export async function dispatchPoint10xStage38Once({
  request,
  sourceComment,
  api,
  nowMs = Date.now()
}) {
  const bound = validatePoint10xDispatchRequest(request, sourceComment, nowMs);
  if (typeof api !== 'function') hold('GITHUB_API_UNAVAILABLE');

  const identity = await call(api, 'GET', '/user');
  if (identity?.login !== C.owner || identity?.id !== C.ownerId) {
    hold('OWNER_TOKEN_UNVERIFIED');
  }
  const currentMain = async () => {
    const ref = await call(api, 'GET', base + '/git/ref/heads/main');
    const sha = ref?.object?.sha;
    if (!hex40.test(String(sha || '')) || sha !== bound.mainSha)
      hold('MAIN_SHA_DRIFT');
  };
  await currentMain();

  const workflow = await call(
    api,
    'GET',
    base + '/actions/workflows/' + C.workflow
  );
  if (
    workflow?.state !== 'active' ||
    workflow?.path !== C.workflowPath ||
    workflow?.name !== 'NOVELIGHT Point10x Staging identity (manual read-only)'
  ) {
    hold('WORKFLOW_UNVERIFIED');
  }
  for (const [path, sha] of [
    [C.workflowPath, C.workflowBlobSha],
    [C.diagnosticPath, C.diagnosticBlobSha]
  ]) {
    const file = await call(
      api,
      'GET',
      base + '/contents/' + path + '?ref=' + bound.mainSha
    );
    if (file?.sha !== sha || file?.type !== 'file') hold('SOURCE_SHA_DRIFT');
  }

  const issue = await call(
    api,
    'GET',
    base + '/issues/' + C.stagingApprovalIssue
  );
  if (
    issue?.number !== C.stagingApprovalIssue ||
    issue?.user?.login !== C.owner ||
    issue?.user?.id !== C.ownerId ||
    issue?.pull_request ||
    issue?.state !== 'open'
  )
    hold('STAGING_LEDGER_UNVERIFIED');

  const approval = await call(
    api,
    'GET',
    base + '/issues/comments/' + bound.approvalCommentId
  );
  validatePoint10xApproval(approval, bound, nowMs);

  const ledgerPath =
    base + '/issues/' + C.stagingApprovalIssue + '/comments?per_page=100';
  const ledger = await call(api, 'GET', ledgerPath);
  checkClaimLedger(ledger, bound);
  if (
    !ledger.some(
      (comment) =>
        Number(comment?.id) === bound.approvalCommentId &&
        comment?.body === approval.body
    )
  )
    hold('STAGING_APPROVAL_NOT_IN_LEDGER');

  const runsPath =
    base +
    '/actions/workflows/' +
    C.workflow +
    '/runs?event=workflow_dispatch&per_page=100';
  strictRunList(await call(api, 'GET', runsPath), bound);
  await currentMain();

  // A durable OWNER-authored CLAIM is written BEFORE the dispatch. On a
  // timeout, crash, 403 or restart it is permanently spent, not retried.
  const claimBody =
    claimPrefix +
    JSON.stringify({
      requestId: bound.requestId,
      mainSha: bound.mainSha,
      scope: C.scope,
      stagingRef: C.stagingRef,
      approvalCommentId: bound.approvalCommentId
    });
  const claim = await call(
    api,
    'POST',
    base + '/issues/' + C.stagingApprovalIssue + '/comments',
    { body: claimBody }
  );
  if (
    claim?.body !== claimBody ||
    claim?.user?.login !== C.owner ||
    claim?.user?.id !== C.ownerId ||
    claim?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(claim?.id)
  )
    hold('CLAIM_UNVERIFIED');

  const claims = await call(api, 'GET', ledgerPath);
  if (!Array.isArray(claims) || claims.length >= 100) hold('LEDGER_CAPACITY');
  const matching = claims.filter((item) => {
    if (!String(item?.body || '').startsWith(claimPrefix)) return false;
    let value;
    try {
      value = JSON.parse(item.body.slice(claimPrefix.length));
    } catch {
      hold('LEDGER_INVALID');
    }
    return value?.mainSha === bound.mainSha && value?.scope === C.scope;
  });
  if (matching.length !== 1 || Number(matching[0]?.id) !== claim.id) {
    hold('DUPLICATE_CLAIM');
  }
  await currentMain();
  strictRunList(await call(api, 'GET', runsPath), bound);
  await call(
    api,
    'POST',
    base + '/actions/workflows/' + C.workflow + '/dispatches',
    {
      ref: 'main',
      inputs: {
        main_sha: bound.mainSha,
        scope: C.scope,
        confirmation: C.confirmation
      }
    }
  );
  return Object.freeze({
    status: 'DISPATCH_ACCEPTED_UNVERIFIED_STAGING_RESULT',
    mainSha: bound.mainSha,
    stagingRef: C.stagingRef,
    workflow: C.workflow,
    claimCommentId: claim.id,
    secretValuesExposed: false,
    productionMutation: false
  });
}
