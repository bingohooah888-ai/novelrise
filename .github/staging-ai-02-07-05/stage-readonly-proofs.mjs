// 02-07-05 dormant Staging preflight observation validators.
// No live adapters, CLI entrypoint, secrets, network calls or workflow wiring.
// Trusted protected runner must supply separately reviewed, read-only observers.
const REF = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + REF + '.supabase.co';
const REPO = 'bingohooah888-ai/novelrise';
const MODEL = 'gpt-5.6-luna';
const MIGRATION = '20261101060000_novelight_ai_020705_one_shot_claim';
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OBSERVERS = [
  'readMain',
  'readRunnerProtection',
  'readPreview',
  'readMigration',
  'readSyntheticConsent',
  'readBillingProtection'
];

function exactScope(value, approved) {
  return value?.repository === REPO &&
    value?.stagingProjectRef === REF &&
    value?.mainSha === approved.mainSha &&
    value?.previewDeploymentId === approved.previewDeploymentId &&
    value?.approvalCommentId === approved.approvalCommentId &&
    value?.runId === approved.runId &&
    value?.novelId === approved.novelId &&
    value?.episodeId === approved.episodeId;
}

function validApproved(a) {
  return a?.repository === REPO &&
    a?.stagingProjectRef === REF &&
    SHA.test(a?.mainSha ?? '') &&
    /^dpl_[a-z0-9]+$/iu.test(a?.previewDeploymentId ?? '') &&
    Number.isSafeInteger(a?.approvalCommentId) && a.approvalCommentId > 0 &&
    Number.isSafeInteger(a?.runId) && a.runId > 0 &&
    UUID.test(a?.actorId ?? '') &&
    Number.isSafeInteger(a?.novelId) && a.novelId > 0 &&
    Number.isSafeInteger(a?.episodeId) && a.episodeId > 0 &&
    a?.provider === 'openai' && a?.model === MODEL &&
    Number.isSafeInteger(a?.capMicros) && a.capMicros > 0 &&
    a.capMicros <= 10000000 &&
    typeof a?.consentRevision === 'string' &&
    /^[a-z0-9][a-z0-9._-]{3,119}$/iu.test(a.consentRevision) &&
    Number.isFinite(Date.parse(a?.expiresAt));
}

// Values obtained from an untrusted API are validated here, but authentic
// provenance and permission-scoped transport must be established by a
// separately approved runner: this module NEVER self-certifies an observer.
export function create020705ReadOnlyStageProofs({ approved, observers, now = Date.now } = {}) {
  if (
    !validApproved(approved) ||
    !observers ||
    OBSERVERS.some((name) => typeof observers[name] !== 'function') ||
    typeof now !== 'function'
  ) throw new Error('AI_020705_PROOF_CONFIG_DENIED');

  async function check(scope, key, predicate) {
    const current = now();
    if (!exactScope(scope, approved) ||
        !Number.isFinite(current) ||
        current >= Date.parse(approved.expiresAt) ||
        Date.parse(approved.expiresAt) - current > 3600000) return false;
    try {
      const observation = await observers[key](
        Object.freeze({ ...scope })
      );
      return predicate(observation) === true;
    } catch {
      // Never leak API response bodies, JWTs, secrets or manuscript in errors.
      return false;
    }
  }

  return Object.freeze({
    verifyCurrentMain: (scope) => check(scope, 'readMain',
      (x) => x?.repository === REPO && x?.branch === 'main' &&
        x?.sha === approved.mainSha && x?.verifiedReadOnly === true),

    verifyProtectedRunner: (scope) => check(scope, 'readRunnerProtection',
      (x) => x?.repository === REPO && x?.runId === approved.runId &&
        x?.actor === 'bingohooah888-ai' &&
        x?.triggeringActor === 'bingohooah888-ai' &&
        x?.ref === 'refs/heads/main' &&
        x?.sha === approved.mainSha &&
        x?.environment === 'staging' &&
        x?.environmentReviewerApproved === true &&
        x?.stagingOnlyCredentials === true &&
        x?.protectedExecution === true),

    verifyApprovedPreview: (scope) => check(scope, 'readPreview',
      (x) => x?.id === approved.previewDeploymentId &&
        x?.projectName === 'novelrise' &&
        x?.repository === REPO &&
        x?.gitCommitSha === approved.mainSha &&
        x?.target === 'preview' &&
        x?.state === 'READY' &&
        x?.ssoProtected === true &&
        x?.stagingSupabaseUrl === URL &&
        x?.ownerPreviewApproved === true),

    verifyAtomicMigration: (scope) => check(scope, 'readMigration',
      (x) => x?.projectRef === REF &&
        x?.supabaseUrl === URL &&
        x?.migrationVersion === MIGRATION &&
        x?.applied === true &&
        x?.oneShotFunctionPresent === true &&
        x?.serviceRoleOnly === true),

    verifySyntheticConsent: (scope) => check(scope, 'readSyntheticConsent',
      (x) => x?.projectRef === REF &&
        x?.actorId === approved.actorId &&
        x?.novelId === approved.novelId &&
        x?.episodeId === approved.episodeId &&
        x?.chunkIndex === 0 &&
        x?.verifiedSynthetic === true &&
        x?.explicitOwnerConsent === true &&
        x?.consentRevision === approved.consentRevision &&
        x?.expiresAt === approved.expiresAt),

    verifyProviderBillingLimit: (scope) => check(scope, 'readBillingProtection',
      (x) => x?.provider === 'openai' &&
        x?.model === MODEL &&
        x?.currency === 'JPY' &&
        x?.providerAccountVerified === true &&
        x?.currentOfficialRatesVerified === true &&
        x?.exchangeRateVerified === true &&
        x?.singleAttemptNoRetry === true &&
        x?.capEnforcedExternally === true &&
        Number.isSafeInteger(x?.worstCaseTotalMicros) &&
        x.worstCaseTotalMicros > 0 &&
        x.worstCaseTotalMicros <= approved.capMicros)
  });
}
