// Supabase Management API adapter for one exact Phase 2 isolated data-less branch.
// This module cannot grant staging approval. It has no CLI or auto-execution.
// Only invoke from the audited main-only OWNER workflow after the approval
// comment is claimed and a dedicated cost authorization is proven.
const PARENT = 'fiepaguycecrredwrcwx';
const SHARED = 'wmlzjgvxgoyrovdhbqbg';
const ENDPOINT = 'https://api.supabase.com/v1';
const ID = /^[1-9][0-9]*$/u;
const REF = /^[a-z0-9]{20}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function deny(reason) {
  throw new Error('COMMUNITY_PHASE2_BRANCH_DENIED: ' + reason);
}
function guard({ grant, managementToken }) {
  if (
    grant?.status !== 'INDEPENDENT_PROTECTED_EXECUTION_GRANT' ||
    grant?.oneUseBudgetCapEnforced !== true ||
    grant?.protectedEnvironmentVerified !== true ||
    grant?.productionExcluded !== true ||
    grant?.scope !== 'community-phase2-joint-hosted-authenticated-write' ||
    grant?.runAuthorized !== true ||
    grant?.stagingCostApproved !== true ||
    grant?.productionMutationApproved !== false ||
    !ID.test(String(grant.runId || '')) ||
    !ID.test(String(grant.requestCommentId || '')) ||
    !/^[a-f0-9]{40}$/u.test(grant.mainSha || '') ||
    !/^[a-f0-9]{40}$/u.test(grant.candidateSha || '') ||
    grant.mainSha === grant.candidateSha ||
    typeof managementToken !== 'string' ||
    managementToken.length < 20
  ) {
    deny('missing reviewed one-use staging authorization');
  }
}
function requestOptions(token, method, body) {
  return {
    method,
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  };
}
function validateBranch(branch, expectedName) {
  if (
    !branch ||
    !UUID.test(branch.id || '') ||
    !REF.test(branch.project_ref || '') ||
    branch.project_ref === PARENT ||
    branch.project_ref === SHARED ||
    branch.parent_project_ref !== PARENT ||
    branch.name !== expectedName ||
    branch.is_default !== false ||
    branch.persistent !== false ||
    branch.with_data !== false
  ) {
    deny('created branch does not prove data-less isolated ownership');
  }
}
function nameFor(runId) {
  if (!ID.test(String(runId))) deny('invalid exact run identifier');
  return 'community-phase2-hosted-' + String(runId);
}

export async function createPhase2IsolatedBranch({
  grant,
  managementToken,
  fetchImpl = fetch
}) {
  guard({ grant, managementToken });
  const name = nameFor(grant.runId);
  let response;
  try {
    response = await fetchImpl(
      ENDPOINT + '/projects/' + PARENT + '/branches',
      requestOptions(managementToken, 'POST', {
        branch_name: name,
        persistent: false,
        with_data: false,
        is_default: false
      })
    );
  } catch {
    // A timed-out POST may already have created a billable branch.
    // Never retry automatically: reconcile the exact run name using GET.
    deny('branch creation outcome unknown; inventory reconciliation required');
  }
  if (response?.status !== 201) {
    deny('branch creation unconfirmed; inventory reconciliation required');
  }
  let branch;
  try {
    branch = await response.json();
  } catch {
    deny('branch response unreadable; inventory reconciliation required');
  }
  try {
    validateBranch(branch, name);
  } catch {
    // A 201 response proves a POST was accepted, not that its metadata is
    // trustworthy. The remote branch may already incur charges. Do not
    // retry POST; require a fresh inventory check and guarded disposal.
    deny('branch response identity unconfirmed; inventory reconciliation required');
  }
  return Object.freeze({
    id: branch.id,
    ref: branch.project_ref,
    parentRef: PARENT,
    name,
    runId: String(grant.runId),
    requestCommentId: String(grant.requestCommentId),
    mainSha: grant.mainSha,
    candidateSha: grant.candidateSha,
    withData: false,
    dataCopied: false,
    deleteRequired: true
  });
}

async function listBranches(token, fetchImpl) {
  const response = await fetchImpl(
    ENDPOINT + '/projects/' + PARENT + '/branches',
    requestOptions(token, 'GET')
  );
  if (response.status !== 200) deny('cannot verify isolated branch listing');
  const rows = await response.json();
  if (!Array.isArray(rows)) deny('invalid branch listing');
  return rows;
}

// Read-only recovery after a create POST times out, returns an ambiguous
// status, or returns unreadable metadata. It NEVER retries creation or deletes.
export async function reconcilePhase2IsolatedBranchCreation({
  grant,
  managementToken,
  fetchImpl = fetch
}) {
  guard({ grant, managementToken });
  const name = nameFor(grant.runId);
  let rows;
  try {
    rows = await listBranches(managementToken, fetchImpl);
  } catch {
    deny('branch inventory reconciliation unavailable');
  }
  const matches = rows.filter((row) => row?.name === name);
  if (matches.length > 1) {
    deny('multiple branches use the approved run name');
  }
  if (matches.length === 0) {
    // The API might be eventually consistent: absence here is not a license
    // to repeat the POST or proof that any billable branch was cleaned up.
    return Object.freeze({
      status: 'NO_BRANCH_OBSERVED_DO_NOT_RETRY',
      runId: String(grant.runId),
      requestCommentId: String(grant.requestCommentId),
      creationRetryAuthorized: false,
      deletionVerified: false
    });
  }
  validateBranch(matches[0], name);
  const created = Object.freeze({
    id: matches[0].id,
    ref: matches[0].project_ref,
    parentRef: PARENT,
    name,
    runId: String(grant.runId),
    requestCommentId: String(grant.requestCommentId),
    mainSha: grant.mainSha,
    candidateSha: grant.candidateSha,
    withData: false,
    dataCopied: false,
    deleteRequired: true
  });
  return Object.freeze({
    status: 'BRANCH_FOUND_REQUIRES_CLEANUP',
    created,
    creationRetryAuthorized: false,
    deletionVerified: false
  });
}

// For safety, preflight also independently checks that the exact branch exists
// in the live Management API listing before issuing an irreversible DELETE.
// This is never a generic "delete project" endpoint.
export async function destroyPhase2IsolatedBranch({
  grant,
  created,
  managementToken,
  fetchImpl = fetch
}) {
  guard({ grant, managementToken });
  const expectedName = nameFor(grant.runId);
  if (
    created?.name !== expectedName ||
    created?.runId !== String(grant.runId) ||
    created?.requestCommentId !== String(grant.requestCommentId) ||
    created?.parentRef !== PARENT ||
    created?.dataCopied !== false ||
    created?.withData !== false ||
    created?.deleteRequired !== true ||
    !REF.test(created?.ref || '') ||
    created.ref === PARENT ||
    created.ref === SHARED ||
    !UUID.test(created?.id || '')
  ) {
    deny('unproven disposable branch deletion request');
  }
  const before = await listBranches(managementToken, fetchImpl);
  const matched = before.filter((row) => row.id === created.id);
  if (matched.length !== 1) deny('exact disposable branch not found');
  validateBranch(matched[0], expectedName);
  if (matched[0].project_ref !== created.ref) {
    deny('branch ref changed since provisioning');
  }
  const response = await fetchImpl(
    ENDPOINT + '/branches/' + created.id + '?force=true',
    requestOptions(managementToken, 'DELETE')
  );
  if (response.status !== 200) deny('branch deletion failed');
  const after = await listBranches(managementToken, fetchImpl);
  if (after.some((row) => row.id === created.id)) {
    deny('branch remains after deletion request');
  }
  return Object.freeze({
    status: 'CONFIRMED_CLEAN',
    deleted: true,
    ref: created.ref,
    runId: String(grant.runId),
    verifiedAbsent: true
  });
}
