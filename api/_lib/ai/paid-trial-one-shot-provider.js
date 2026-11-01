// 02-07-05 dormant Staging-only provider guard. NOT imported by any HTTP
// endpoint. Never grants permission, sets budgets or generates credentials.
// The separately approved caller must first verify GitHub OWNER ledger,
// Preview identity, source consent and Auth; all are required input evidence.
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING_URL = 'https://' + STAGING_REF + '.supabase.co';
const SHA = /^[a-f0-9]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function deny() {
  throw new Error('AI_020705_PAID_ONE_SHOT_DENIED');
}

export function createPaidTrialOneShotOpenAiProvider({
  serviceClient,
  underlyingProvider,
  approved,
  deployment,
  now = Date.now
} = {}) {
  const expiresAt = Date.parse(approved?.expiresAt);
  const current = now();
  if (
    typeof serviceClient?.rpc !== 'function' ||
    typeof underlyingProvider?.generate !== 'function' ||
    !Number.isSafeInteger(approved?.commentId) ||
    approved.commentId <= 0 ||
    !UUID.test(approved?.ownerId ?? '') ||
    !Number.isSafeInteger(approved?.novelId) ||
    approved.novelId <= 0 ||
    !Number.isSafeInteger(approved?.episodeId) ||
    approved.episodeId <= 0 ||
    approved.provider !== 'openai' ||
    approved.model !== 'gpt-5.6-luna' ||
    approved.routeCount !== 1 ||
    approved.maxProviderCalls !== 1 ||
    approved.noRetry !== true ||
    approved.fallbackDisabled !== true ||
    !Number.isSafeInteger(approved.capMicros) ||
    approved.capMicros < 1 ||
    approved.capMicros > 10000000 ||
    !SHA.test(approved?.mainSha ?? '') ||
    !DEPLOYMENT.test(approved?.previewDeploymentId ?? '') ||
    !Number.isFinite(current) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= current ||
    expiresAt - current > 3600000 ||
    deployment?.projectRef !== STAGING_REF ||
    deployment?.supabaseUrl !== STAGING_URL ||
    deployment?.isProduction !== false ||
    deployment?.ready !== true ||
    deployment?.sha !== approved.mainSha ||
    deployment?.id !== approved.previewDeploymentId ||
    // This flag is never set by this module; only a separate authorized
    // Staging runtime may construct this evidence.
    approved?.ownerLedgerClaimed !== true ||
    approved?.exactScopeVerified !== true
  ) {
    deny();
  }
  return Object.freeze({
    async generate(args) {
      // This is a guard immediately BEFORE a potentially billable network
      // request, after the outer Router's atomic budget reservation.
      if (
        args?.model !== 'gpt-5.6-luna' ||
        !Number.isFinite(now()) ||
        now() >= expiresAt
      ) {
        deny();
      }
      const { data, error } = await serviceClient.rpc(
        'novelight_ai_020705_claim_once',
        {
          p_approval_comment_id: approved.commentId,
          p_actor_id: approved.ownerId,
          p_novel_id: approved.novelId,
          p_episode_id: approved.episodeId,
          p_main_sha: approved.mainSha,
          p_preview_deployment_id: approved.previewDeploymentId,
          p_provider: 'openai',
          p_model: 'gpt-5.6-luna',
          p_ceiling_micros: approved.capMicros,
          p_expires_at: approved.expiresAt,
          p_project_ref: STAGING_REF
        }
      );
      // Any DB outage/missing migration/duplicate/timeout consumes no
      // permission in-process and cannot fall back to a model invocation.
      if (error || data !== true || now() >= expiresAt) deny();
      // No retry here, even if underlyingProvider returns a retryable error.
      return underlyingProvider.generate(args);
    }
  });
}
