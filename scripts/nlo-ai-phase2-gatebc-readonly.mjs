// NLO AI 02-07-05: offline B/C metadata adapter; no network or credentials.
// Never use these metadata checks as live permission or a deployment trigger.
import { inspect020705PreviewPrecreation } from '../.github/staging-ai-02-07-05/preview-precreation-readonly.mjs';

const VERCEL_ID = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const STAGING_ID = 'wmlzjgvxgoyrovdhbqbg';

export function assess020705GateBCReadOnly({
  scope,
  currentMain,
  existingPreview = null,
  envMetadata = [],
  vercelProject = null,
  stagingProject = null,
  runnerOfflineResult = null
} = {}) {
  // The existing Stage B validator owns SHA, repo, branch, target and env
  // checks. This adapter adds independent environment metadata requirements.
  const preview = inspect020705PreviewPrecreation({
    scope,
    currentMain,
    existingPreview,
    envMetadata
  });
  const vercelIdentity =
    vercelProject?.id === VERCEL_ID && vercelProject?.name === 'novelrise';
  const previewSso =
    vercelProject?.ssoProtection?.enabled === true &&
    vercelProject.ssoProtection.deploymentType === 'all_except_custom_domains';
  const stagingIdentity =
    stagingProject?.id === STAGING_ID &&
    stagingProject.id !== 'fiepaguycecrredwrcwx';

  const sixOfflineContracts =
    runnerOfflineResult?.status === 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH' &&
    runnerOfflineResult?.authorizesExecution === false &&
    Array.isArray(runnerOfflineResult.checks) &&
    runnerOfflineResult.checks.length === 6 &&
    runnerOfflineResult.checks.every((item) => item?.verified === true);

  const blockers = [];
  if (!vercelIdentity) blockers.push('VERCEL_PROJECT_IDENTITY_UNVERIFIED');
  if (!previewSso) blockers.push('VERCEL_PREVIEW_SSO_UNVERIFIED');
  if (!stagingIdentity) blockers.push('SUPABASE_STAGING_IDENTITY_UNVERIFIED');
  if (preview.missingBranchScopedEnvNames.length) {
    blockers.push('BRANCH_SCOPED_PREVIEW_ENV_MISSING');
  }
  if (existingPreview === null) {
    blockers.push('NEW_PREVIEW_REQUIRES_STAGING_APPROVAL');
  } else if (
    preview.status !== 'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL'
  ) {
    blockers.push('CURRENT_SHA_PREVIEW_NOT_PROVEN');
  }
  if (!sixOfflineContracts) blockers.push('RUNNER_OFFLINE_PROOFS_UNVERIFIED');

  // These three gaps can only close via authentic, separately approved live
  // evidence. Raw snapshots and mock observer claims MUST NOT grant authority.
  blockers.push('PROTECTED_RUNNER_LIVE_NOT_PROVEN');
  blockers.push('INDEPENDENT_WATCHDOG_LIVE_KILL_NOT_PROVEN');
  blockers.push('OWNER_ONE_SHOT_COST_APPROVAL_NOT_PROVEN');

  return Object.freeze({
    status: 'GATE_BC_NO_GO_LIVE_PROOFS_PENDING',
    gateB: Object.freeze({
      status: preview.status,
      expectedMainSha: preview.expectedMainSha,
      plannedBranch: preview.plannedBranch,
      missingBranchScopedEnvNames: preview.missingBranchScopedEnvNames,
      vercelIdentity,
      previewSso,
      stagingIdentity
    }),
    gateC: Object.freeze({
      offlineContractStatus: sixOfflineContracts
        ? 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH'
        : 'OFFLINE_PROOFS_UNVERIFIED',
      liveProtectedRunnerVerified: false,
      independentWatchdogKillVerified: false
    }),
    blockers: Object.freeze(blockers),
    secretsInspected: false,
    cloudMutations: 0,
    authorizesPreviewCreation: false,
    authorizesStagingWrite: false,
    authorizesRealJwt: false,
    authorizesPaidCall: false,
    authorizesProductionChange: false
  });
}
