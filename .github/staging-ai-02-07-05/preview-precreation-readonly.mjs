// 02-07-05: read-only PRE-CREATION Preview evidence checker.
// No Vercel API, deploy call, environment write, token or network request.
const REPOSITORY = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const PRODUCTION = 'fiepaguycecrredwrcwx';
const SHA = /^[a-f0-9]{40}$/u;
// A shared Preview key is not evidence of Staging-only secret isolation.
const CREDENTIAL_KEYS = new Set([
  'SUPABASE_SECRET_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY'
]);
const REQUIRED_NAMES = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_AI_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_020705_ONE_SHOT_ENABLED'
]);

function deny() {
  throw new Error('AI_020705_PREVIEW_PREFLIGHT_DENIED');
}

export function inspect020705PreviewPrecreation({
  scope,
  currentMain,
  existingPreview = null,
  envMetadata = [],
  stagingBranchHeadSha = null
} = {}) {
  if (
    scope?.repository !== REPOSITORY ||
    scope?.stagingProjectRef !== STAGING ||
    scope?.stagingProjectRef === PRODUCTION ||
    !SHA.test(scope?.mainSha ?? '') ||
    (scope?.candidateSha != null &&
      (!SHA.test(scope.candidateSha) ||
        scope.candidateSha === scope.mainSha)) ||
    typeof scope?.branch !== 'string' ||
    !/^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(scope.branch) ||
    !currentMain ||
    currentMain.repository !== REPOSITORY ||
    currentMain.sha !== scope.mainSha ||
    (stagingBranchHeadSha !== null && !SHA.test(stagingBranchHeadSha)) ||
    !Array.isArray(envMetadata) ||
    envMetadata.some(
      (item) =>
        !item ||
        typeof item.key !== 'string' ||
        !Array.isArray(item.target) ||
        (item.gitBranch != null && typeof item.gitBranch !== 'string')
    )
  )
    deny();

  const configured = new Set(
    envMetadata
      .filter(
        (item) =>
          item.gitBranch === scope.branch && item.target.includes('preview')
      )
      .map((item) => item.key)
  );
  const missingNames = REQUIRED_NAMES.filter((key) => !configured.has(key));
  // Optional common Preview entries may be inherited but their project
  // identity cannot be established from metadata without reading secrets.
  const sharedPreview = new Set(
    envMetadata
      .filter(
        (item) => item.gitBranch == null && item.target.includes('preview')
      )
      .map((item) => item.key)
  );
  const sharedCredentialsNeedingIsolationProof = Object.freeze(
    [...CREDENTIAL_KEYS].filter(
      (key) => sharedPreview.has(key) && !configured.has(key)
    )
  );
  const targetSha = scope.candidateSha ?? scope.mainSha;
  const branchHeadMatchesMain =
    stagingBranchHeadSha === null
      ? null
      : stagingBranchHeadSha === scope.mainSha;
  const branchHeadMatchesTarget =
    stagingBranchHeadSha === null ? null : stagingBranchHeadSha === targetSha;
  let status = 'NO_CURRENT_SHA_PREVIEW_REQUIRES_STAGING_APPROVAL';
  if (branchHeadMatchesTarget === false) {
    status = 'STAGING_BRANCH_SHA_MISMATCH';
  } else if (existingPreview !== null) {
    if (
      existingPreview.repository !== REPOSITORY ||
      existingPreview.projectRef === PRODUCTION ||
      existingPreview.projectRef !== STAGING ||
      existingPreview.branch !== scope.branch ||
      existingPreview.target !== 'preview' ||
      !/^dpl_[A-Za-z0-9]+$/u.test(existingPreview.id ?? '')
    )
      deny();
    status =
      existingPreview.sha !== targetSha
        ? 'EXISTING_PREVIEW_SHA_MISMATCH'
        : existingPreview.state !== 'READY'
          ? 'EXISTING_PREVIEW_NOT_READY'
          : scope.candidateSha != null
            ? 'CANDIDATE_PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL'
            : 'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL';
  }
  return Object.freeze({
    status,
    expectedMainSha: scope.mainSha,
    expectedCandidateSha: scope.candidateSha ?? null,
    expectedPreviewSha: targetSha,
    plannedBranch: scope.branch,
    missingBranchScopedEnvNames: Object.freeze(missingNames),
    sharedPreviewEnvNames: Object.freeze(
      REQUIRED_NAMES.filter((key) => sharedPreview.has(key))
    ),
    sharedCredentialsNeedingIsolationProof,
    branchHeadMatchesMain,
    branchHeadMatchesTarget,
    stagingCredentialsVerified: false,
    note: 'metadata-only; secret VALUES, permissions and protection not verified',
    noDeploymentCreated: true,
    authorizesPreviewCreation: false,
    authorizesStagingWrite: false,
    authorizesRealJwt: false,
    authorizesPaidCall: false,
    authorizesAiEnablement: false
  });
}

/**
 * Candidate SHA Staging-first PRE-ADMISSION, using the existing Preview
 * validator. Separates the trusted current main (base) from one immutable
 * candidate commit. All inputs are OFFLINE metadata, not authenticated
 * GitHub/Vercel/Cloudflare observations. This cannot grant a real approval.
 *
 * Deliberately NOT imported by the paid runner or its protected workflow.
 * The live OWNER ledger, atomic DB claim and signed external watchdog must
 * get a separate reviewed candidate-aware adapter before any real execution.
 */
export function inspect020705CandidateStagingOffline({
  scope,
  currentMain,
  stagingBranchHeadSha,
  existingPreview,
  envMetadata,
  ownerIntent,
  watchdogPlan,
  budget,
  now = Date.now
} = {}) {
  const refuse = () => {
    throw new Error('AI_020705_CANDIDATE_SCOPE_DENIED');
  };
  try {
    const current = typeof now === 'function' ? now() : NaN;
    const expires = Date.parse(ownerIntent?.expiresAt);
    const sha = scope?.candidateSha;
    const branch = scope?.branch;
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const planned = {
      repository: scope?.repository,
      stagingProjectRef: scope?.stagingProjectRef,
      mainSha: scope?.mainSha,
      candidateSha: sha,
      branch,
      previewDeploymentId: existingPreview?.id,
      approvalCommentId: ownerIntent?.approvalCommentId,
      runId: ownerIntent?.runId,
      actorId: ownerIntent?.actorId,
      novelId: ownerIntent?.novelId,
      episodeId: ownerIntent?.episodeId,
      expiresAt: ownerIntent?.expiresAt
    };
    const match = (o) =>
      o && Object.entries(planned).every(([key, value]) => o[key] === value);
    if (
      !SHA.test(sha ?? '') ||
      sha === scope.mainSha ||
      !SHA.test(stagingBranchHeadSha ?? '') ||
      scope.repository !== REPOSITORY ||
      scope.stagingProjectRef !== STAGING ||
      !/^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(branch ?? '') ||
      !Number.isFinite(current) ||
      !Number.isFinite(expires) ||
      expires <= current ||
      expires - current > 3600000 ||
      !match(ownerIntent) ||
      !match(watchdogPlan) ||
      ownerIntent.ownerLogin !== 'bingohooah888-ai' ||
      ownerIntent.approvalIssueNumber !== 294 ||
      !Number.isSafeInteger(ownerIntent.approvalCommentId) ||
      ownerIntent.approvalCommentId < 1 ||
      !Number.isSafeInteger(ownerIntent.runId) ||
      ownerIntent.runId < 1 ||
      !uuid.test(ownerIntent.actorId ?? '') ||
      !Number.isSafeInteger(ownerIntent.novelId) ||
      ownerIntent.novelId < 1 ||
      !Number.isSafeInteger(ownerIntent.episodeId) ||
      ownerIntent.episodeId < 1 ||
      watchdogPlan.independentHostRequired !== true ||
      watchdogPlan.stopAndRevokeRequired !== true ||
      watchdogPlan.independentZeroCensusRequired !== true ||
      watchdogPlan.stopOnTimeoutRequired !== true ||
      budget?.provider !== 'openai' ||
      budget?.model !== 'gpt-5.6-luna' ||
      budget?.currency !== 'JPY' ||
      budget?.maxPosts !== 1 ||
      budget?.noRetry !== true ||
      budget?.maxDurationMinutes !== 60 ||
      !Number.isSafeInteger(budget.capMicros) ||
      budget.capMicros <= 0 ||
      budget.capMicros > 10000000 ||
      budget.capMicros !== ownerIntent.capMicros ||
      budget.capMicros !== watchdogPlan.capMicros ||
      !existingPreview
    )
      refuse();

    const preview = inspect020705PreviewPrecreation({
      scope,
      currentMain,
      stagingBranchHeadSha,
      existingPreview,
      envMetadata
    });
    const matchesTarget =
      preview.branchHeadMatchesTarget === true &&
      preview.expectedPreviewSha === sha &&
      preview.status ===
        'CANDIDATE_PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL' &&
      preview.missingBranchScopedEnvNames.length === 0 &&
      preview.sharedCredentialsNeedingIsolationProof.length === 0;
    return Object.freeze({
      status: matchesTarget
        ? 'CANDIDATE_SCOPE_METADATA_MATCHES_LIVE_PROOFS_REQUIRED'
        : 'CANDIDATE_SCOPE_PRECONDITIONS_NO_GO',
      baseMainSha: scope.mainSha,
      candidateSha: sha,
      branch,
      previewDeploymentId: existingPreview.id,
      preview,
      ownerApprovalAuthenticated: false,
      independentStopVerified: false,
      billingEntitlementVerified: false,
      protectedRunnerWired: false,
      authorizesExecution: false,
      authorizesPreviewCreation: false,
      authorizesStagingWrite: false,
      authorizesPaidCall: false,
      authorizesMutation: false
    });
  } catch {
    // Ignore all callback/transport error text to avoid secret exfiltration.
    refuse();
  }
}
