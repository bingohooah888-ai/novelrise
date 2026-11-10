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
  const branchHeadMatchesMain =
    stagingBranchHeadSha === null
      ? null
      : stagingBranchHeadSha === scope.mainSha;
  let status = 'NO_CURRENT_SHA_PREVIEW_REQUIRES_STAGING_APPROVAL';
  if (branchHeadMatchesMain === false) {
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
      existingPreview.sha !== scope.mainSha
        ? 'EXISTING_PREVIEW_SHA_MISMATCH'
        : existingPreview.state !== 'READY'
          ? 'EXISTING_PREVIEW_NOT_READY'
          : 'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL';
  }
  return Object.freeze({
    status,
    expectedMainSha: scope.mainSha,
    plannedBranch: scope.branch,
    missingBranchScopedEnvNames: Object.freeze(missingNames),
    sharedPreviewEnvNames: Object.freeze(
      REQUIRED_NAMES.filter((key) => sharedPreview.has(key))
    ),
    sharedCredentialsNeedingIsolationProof,
    branchHeadMatchesMain,
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
