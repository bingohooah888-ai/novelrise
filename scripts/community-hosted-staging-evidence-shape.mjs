// Read-only structural inspection for future Community Phase 1 hosted Staging.
// No environment API calls, payment APIs, claims, execution grants or CLI.
// Caller-supplied snapshots are NOT authenticated facts, even if valid.
const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const FEATURE = '91114a536688411caa37a5640a14eca01c8e0335';
const PARENT = 'fiepaguycecrredwrcwx';
const SHARED = 'wmlzjgvxgoyrovdhbqbg';
const SHA = /^[0-9a-f]{40}$/u;
const ID = /^[1-9][0-9]*$/u;
const STAGING_ENV = 'community-hosted-isolated';

function deny() {
  // Do not echo raw API responses or cost-account credentials to logs.
  throw new Error('COMMUNITY_HOSTED_EVIDENCE_SHAPE_DENIED');
}

function positiveMinor(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function checkRun(run) {
  if (
    run?.repository !== REPO ||
    run?.scope !== 'community-phase1-hosted-authenticated-write' ||
    !SHA.test(run.mainSha ?? '') ||
    run.candidateSha !== FEATURE ||
    !ID.test(run.requestCommentId ?? '') ||
    !ID.test(run.runId ?? '')
  ) {
    deny();
  }
}

function checkEnvironment(environment, policies) {
  if (
    environment?.name !== STAGING_ENV ||
    environment.prevent_self_review !== true ||
    environment.can_admins_bypass !== false ||
    environment.deployment_branch_policy?.protected_branches !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true ||
    !Array.isArray(environment.protection_rules)
  ) {
    deny();
  }

  const reviewers = environment.protection_rules.filter(
    (rule) => rule?.type === 'required_reviewers'
  );
  const independentReview = reviewers.some(
    (rule) =>
      Array.isArray(rule.reviewers) &&
      rule.reviewers.some(
        (entry) =>
          entry?.type === 'User' &&
          typeof entry.reviewer?.login === 'string' &&
          entry.reviewer.login.length > 0 &&
          entry.reviewer.login !== OWNER
      )
  );
  if (
    !independentReview ||
    policies?.total_count !== 1 ||
    !Array.isArray(policies.branch_policies) ||
    policies.branch_policies.length !== 1 ||
    policies.branch_policies[0]?.name !== 'main' ||
    policies.branch_policies[0]?.type !== 'branch'
  ) {
    deny();
  }
}

function checkBudget(run, approval, limits) {
  if (
    approval?.requestCommentId !== run.requestCommentId ||
    approval.runId !== run.runId ||
    approval.mainSha !== run.mainSha ||
    approval.candidateSha !== run.candidateSha ||
    approval.currency !== 'JPY' ||
    !positiveMinor(approval.maxTotalMinor) ||
    limits?.currency !== approval.currency ||
    limits.requestCommentId !== run.requestCommentId ||
    limits.runId !== run.runId
  ) {
    deny();
  }
  const supabase = limits.supabase;
  const vercel = limits.vercel;
  if (
    supabase?.provider !== 'supabase' ||
    vercel?.provider !== 'vercel' ||
    supabase.enforcement !== 'provider-hard-stop' ||
    vercel.enforcement !== 'provider-hard-stop' ||
    !positiveMinor(supabase.maxMinor) ||
    !positiveMinor(vercel.maxMinor) ||
    supabase.maxMinor > approval.maxTotalMinor ||
    vercel.maxMinor > approval.maxTotalMinor - supabase.maxMinor
  ) {
    deny();
  }
}

function checkIsolation(run, isolation) {
  if (
    isolation?.mode !== 'ephemeral-data-less-branch' ||
    isolation.parentProjectRef !== PARENT ||
    isolation.parentProjectRef === SHARED ||
    isolation.branchName !== 'community-hosted-' + run.runId ||
    isolation.persistent !== false ||
    isolation.withData !== false ||
    isolation.isDefault !== false ||
    isolation.projectRef !== null ||
    isolation.productionMutationAllowed !== false ||
    isolation.sharedStagingMutationAllowed !== false
  ) {
    deny();
  }
}

// All evidence is UNTRUSTED INPUT until a separate authenticated,
// independent runner fetches and verifies it freshly. This function NEVER
// mints a grant, even when every structural field matches.
export function inspectCommunityHostedStagingEvidenceShape({
  run,
  environment,
  branchPolicies,
  ownerBudget,
  providerLimits,
  isolationPlan
}) {
  checkRun(run);
  checkEnvironment(environment, branchPolicies);
  checkBudget(run, ownerBudget, providerLimits);
  checkIsolation(run, isolationPlan);

  return Object.freeze({
    status: 'READ_ONLY_UNAUTHENTICATED_EVIDENCE_SHAPE_ONLY',
    mainSha: run.mainSha,
    candidateSha: run.candidateSha,
    requestCommentId: run.requestCommentId,
    runId: run.runId,
    evidenceAuthenticated: false,
    githubEnvironmentLiveVerified: false,
    providerHardStopLiveVerified: false,
    ownerApprovalLedgerLiveVerified: false,
    isolationCreated: false,
    cleanupVerified: false,
    exclusiveRunVerified: false,
    stagingCostApproved: false,
    mayClaim: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}
