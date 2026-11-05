// NOVELIGHT Point10x: GitHub merger-to-main ancestry proof contract.
// OFFLINE CONTRACT ONLY: passing a fabricated fixture grants no authority.
// Call only on snapshots fetched by a separately trusted-main GitHub event
// actor; never treat any caller-provided shape as OWNER authentication.
export const MERGE_PROOF_REPO = 'bingohooah888-ai/novelrise';
const sha40 = (value) =>
  typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (why) => {
  throw new Error('POINT10X_MERGE_HOLD:' + why);
};

export function inspectMergedPrOnFreshMain({
  pr,
  comparison,
  number,
  expectedHead,
  expectedMerge,
  mainSha,
  approvalCreatedAt
} = {}) {
  if (
    ![2766, 2767].includes(number) ||
    !sha40(expectedHead) ||
    !sha40(expectedMerge) ||
    !sha40(mainSha)
  )
    fail('INVALID_PINNED_INPUTS');
  if (
    !record(pr) ||
    pr.number !== number ||
    pr.state !== 'closed' ||
    pr.draft !== false ||
    pr.merged !== true ||
    pr.merge_commit_sha !== expectedMerge ||
    pr.head?.sha !== expectedHead ||
    pr.head?.repo?.full_name !== MERGE_PROOF_REPO ||
    pr.base?.repo?.full_name !== MERGE_PROOF_REPO ||
    pr.base?.ref !== 'main' ||
    !record(pr.merged_by) ||
    !Number.isSafeInteger(pr.merged_by.id) ||
    pr.merged_by.id <= 0 ||
    typeof pr.merged_by.login !== 'string' ||
    pr.merged_by.login.length < 1
  )
    fail('PR_NOT_AUTHENTICATED_AS_MERGED');
  const mergedAt = Date.parse(pr.merged_at);
  const approvalAt = Date.parse(approvalCreatedAt);
  if (
    !Number.isFinite(mergedAt) ||
    !Number.isFinite(approvalAt) ||
    mergedAt > approvalAt
  )
    fail('APPROVAL_PRECEDES_MERGE');
  // GitHub reports a merge_commit_sha for some UNMERGED PRs too.
  // Only a merged=true, closed, non-Draft record plus ancestry may pass.
  if (
    !record(comparison) ||
    comparison.base_commit?.sha !== expectedMerge ||
    comparison.merge_base_commit?.sha !== expectedMerge ||
    comparison.head_commit?.sha !== mainSha ||
    !['identical', 'ahead'].includes(comparison.status) ||
    !Number.isSafeInteger(comparison.ahead_by) ||
    comparison.ahead_by < 0 ||
    comparison.behind_by !== 0 ||
    (comparison.status === 'identical' && comparison.ahead_by !== 0) ||
    (comparison.status === 'ahead' && comparison.ahead_by < 1)
  )
    fail('MAIN_ANCESTRY_NOT_PROVEN');
  return Object.freeze({
    status: 'NO_GO_MERGED_MAIN_ANCESTRY_SHAPE_ONLY',
    prNumber: number,
    prHeadSha: expectedHead,
    mergedCommitSha: expectedMerge,
    mainSha,
    presentOnMain: true,
    trustedGithubFetchVerified: false,
    ownerAuthenticatedForExecution: false,
    controlSpentConsumed: false,
    mayConnectStaging: false
  });
}
