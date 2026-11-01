// 02-07-05: fail-closed default HTTP assembly for the scoped Staging trial.
// This module DOES NOT enable AI, migrate a database, grant consent or
// provision GitHub/Vercel credentials. All missing evidence => null / denied.
import { verify020705ClaimedOwnerApproval } from
  '../../../.github/staging-ai-02-07-05/owner-paid-trial-ledger.mjs';
import {
  createPaidTrialOneShotOpenAiProvider
} from './paid-trial-one-shot-provider.js';
import { createOwnerNovelBibleLiveTrialBridge } from
  './owner-novel-bible-trial-live.js';
import { createOpenAiTextProvider } from './providers.js';

const STAGING_URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const SHA = /^[a-f0-9]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const ID = /^[1-9][0-9]*$/u;

function deny() {
  throw new Error('AI_020705_GUARDED_TRIAL_DENIED');
}

function numberId(value) {
  if (typeof value !== 'string' || !ID.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolve020705GuardedTrialScope(env = {}, now = Date.now()) {
  let routes;
  try {
    routes = JSON.parse(env.NOVELIGHT_AI_TRIAL_ROUTES_JSON);
  } catch {
    return null;
  }
  const approvedSha = env.NOVELIGHT_AI_020705_APPROVED_MAIN_SHA;
  const approvedPreview = env.NOVELIGHT_AI_020705_PREVIEW_DEPLOYMENT_ID;
  const expiration = Date.parse(env.NOVELIGHT_AI_TRIAL_EXPIRES_AT);
  const maxMicros = numberId(env.NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS);
  const commentId = numberId(env.NOVELIGHT_AI_020705_APPROVAL_COMMENT_ID);
  const runId = numberId(env.NOVELIGHT_AI_020705_APPROVAL_RUN_ID);
  const novelId = numberId(env.NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID);
  const episodeId = numberId(env.NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID);
  if (
    env.NOVELIGHT_AI_020705_ONE_SHOT_ENABLED !== 'true' ||
    env.VERCEL_ENV !== 'preview' ||
    env.NOVELIGHT_AI_020705_APPROVAL_ISSUE_NUMBER !== '294' ||
    env.SUPABASE_URL !== STAGING_URL ||
    !SHA.test(approvedSha ?? '') ||
    env.VERCEL_GIT_COMMIT_SHA !== approvedSha ||
    !DEPLOYMENT.test(approvedPreview ?? '') ||
    env.VERCEL_DEPLOYMENT_ID !== approvedPreview ||
    !Array.isArray(routes) ||
    routes.length !== 1 ||
    routes[0]?.provider !== 'openai' ||
    routes[0]?.model !== 'gpt-5.6-luna' ||
    !maxMicros || maxMicros > 10000000 ||
    !commentId || !runId || !novelId || !episodeId ||
    env.NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX !== '0' ||
    !Number.isFinite(now) || !Number.isFinite(expiration) ||
    expiration <= now || expiration - now > 3600000
  ) return null;
  return Object.freeze({
    mainSha: approvedSha,
    previewDeploymentId: approvedPreview,
    expiresAt: env.NOVELIGHT_AI_TRIAL_EXPIRES_AT,
    capMicros: maxMicros,
    commentId, runId, novelId, episodeId
  });
}

async function read020705PublicOwnerComments({
  issueNumber = 294,
  fetchImpl = globalThis.fetch
} = {}) {
  if (issueNumber !== 294 || typeof fetchImpl !== 'function') deny();
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const url =
      'https://api.github.com/repos/bingohooah888-ai/novelrise/issues/' +
      issueNumber + '/comments?per_page=100&page=' + page;
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'novelight-ai-020705-staging-approval-check'
      },
      signal: globalThis.AbortSignal.timeout(5000)
    });
    if (!response?.ok) deny();
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length > 100) deny();
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  deny(); // Never silently truncate the ledger.
}

// Only the HTTP default export uses this assembly. Legacy trial adapter
// remains importable in unit tests, but is NOT a live HTTP default.
export function createOwnerNovelBible020705GuardedLiveTrialBridge({
  env = process.env,
  now = Date.now,
  readComments = read020705PublicOwnerComments,
  createClientImpl,
  openAiProviderFactory = createOpenAiTextProvider
} = {}) {
  const initial = resolve020705GuardedTrialScope(env, now());
  if (!initial) return null;
  return async function createGuardedTrialBridge({ ownerId, serviceClient }) {
    const scope = resolve020705GuardedTrialScope(env, now());
    if (
      !scope ||
      ownerId?.toLowerCase() !== env.NOVELIGHT_AI_ADMIN_USER_ID?.toLowerCase() ||
      serviceClient?.supabaseUrl !== STAGING_URL ||
      typeof serviceClient?.rpc !== 'function'
    ) deny();

    let approved;
    try {
      const comments = await readComments({ issueNumber: 294 });
      approved = verify020705ClaimedOwnerApproval({
        comments,
        approvalCommentId: scope.commentId,
        runId: scope.runId,
        now: now(),
        expected: {
          actorId: ownerId,
          novelId: scope.novelId,
          episodeId: scope.episodeId,
          mainSha: scope.mainSha,
          previewDeploymentId: scope.previewDeploymentId,
          provider: 'openai',
          model: 'gpt-5.6-luna',
          capMicros: scope.capMicros,
          stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
          consentRevision: env.NOVELIGHT_AI_CONSENT_POLICY_REVISION
        }
      });
    } catch {
      deny();
    }
    const underlyingBridge = createOwnerNovelBibleLiveTrialBridge({
      env, now, createClientImpl,
      openAiProviderFactory({ apiKey }) {
        const provider = openAiProviderFactory({ apiKey });
        return createPaidTrialOneShotOpenAiProvider({
          serviceClient,
          underlyingProvider: provider,
          now,
          approved: {
            commentId: scope.commentId,
            ownerId,
            novelId: scope.novelId,
            episodeId: scope.episodeId,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            routeCount: 1,
            maxProviderCalls: 1,
            noRetry: true,
            fallbackDisabled: true,
            capMicros: scope.capMicros,
            mainSha: scope.mainSha,
            previewDeploymentId: scope.previewDeploymentId,
            expiresAt: scope.expiresAt,
            ownerLedgerClaimed: approved.ownerLedgerClaimed,
            exactScopeVerified: true
          },
          deployment: {
            projectRef: 'wmlzjgvxgoyrovdhbqbg',
            supabaseUrl: STAGING_URL,
            isProduction: false,
            ready: true,
            sha: scope.mainSha,
            id: scope.previewDeploymentId
          }
        });
      },
      geminiProviderFactory() {
        deny();
      }
    });
    if (typeof underlyingBridge !== 'function') deny();
    return underlyingBridge({ ownerId, serviceClient });
  };
}
