// Phase 02-07-04: dormant server-only composition for an owner AI trial.
// Never imported by a public API. No env switches, keys, provider selection,
// consent grants, budget increases or schema changes are supplied here.
// Live activation requires a separately approved runtime, authenticated
// author-JWT adapter, explicit consent and atomic budget/storage verification.
import { createOwnerBibleReviewWorkflow } from './owner-bible-review-workflow.js';
import {
  createOfflineOwnerNovelBibleCheckpoint,
  createSupabaseOwnerNovelBibleCheckpointRepository
} from './owner-novel-bible-checkpoint.js';
import { createSupabaseOwnerBibleReviewRepository } from './owner-bible-review-repository.js';
import { createOwnerNovelBibleModelBridge } from './owner-novel-bible-model-bridge.js';
import { createOwnerNovelBibleVerifiedHistoryReader } from './owner-novel-bible-verified-history.js';
import { createAiRouter } from './router.js';
import {
  createSupabaseAiAudit,
  createSupabaseAiBudget
} from './supabase-store.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable() {
  throw new Error('AI_TRIAL_RUNTIME_UNAVAILABLE');
}

function denied() {
  throw new Error('AI_TRIAL_RUNTIME_DENIED');
}

function workId(value) {
  if (!Number.isSafeInteger(value) || value < 1) denied();
  return value;
}

export function createOwnerNovelBibleTrialRuntime({
  enabled = false,
  externalProcessingApproved = false,
  ownerId,
  authClient,
  serviceClient,
  createAuthorClient,
  permissionCheck,
  readVerifiedHistory,
  checkpointEnabled = false,
  checkpointRepository,
  providers,
  routes,
  cache = null
} = {}) {
  if (
    typeof ownerId !== 'string' ||
    !UUID.test(ownerId) ||
    typeof authClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    typeof createAuthorClient !== 'function' ||
    typeof permissionCheck !== 'function' ||
    (readVerifiedHistory !== undefined &&
      typeof readVerifiedHistory !== 'function') ||
    (checkpointRepository !== undefined &&
      (typeof checkpointRepository?.readSnapshot !== 'function' ||
        typeof checkpointRepository?.compareAndSwap !== 'function')) ||
    !providers ||
    !routes
  ) {
    unavailable();
  }
  const owner = ownerId.toLowerCase();
  // The offline trial uses the existing authoritative analysis checkpoint
  // and revision storage, not HTTP-provided previous chapter text. Tests may
  // inject a synthetic reader; no public route or paid model is enabled here.
  const historyReader =
    readVerifiedHistory === undefined
      ? createOwnerNovelBibleVerifiedHistoryReader({ serviceClient })
      : readVerifiedHistory;
  // The existing owner-only bridge remains one-call/one-chunk. A separately
  // enabled checkpoint journal records only verified successful chunks and
  // never starts an extra paid call or enables the deployed HTTP endpoint.
  const checkpoint = checkpointEnabled
    ? createOfflineOwnerNovelBibleCheckpoint({
        enabled: true,
        repository:
          checkpointRepository ??
          createSupabaseOwnerNovelBibleCheckpointRepository({ serviceClient })
      })
    : undefined;

  // Reuse the existing durable runtime kill switch and cost ceilings,
  // not a browser button or an in-memory flag. Missing DB state fails closed.
  // This gate is read-only; stop/cleanup writers remain independently owned
  // by the existing Staging-only detached stop and cleanup components.
  async function runtimeActive() {
    try {
      const result = await serviceClient
        .from('novelight_ai_runtime_settings')
        .select(
          'enabled,user_day_cap_micros,user_month_cap_micros,' +
            'global_day_cap_micros,global_month_cap_micros'
        )
        .eq('singleton', 1)
        .maybeSingle();
      const row = result?.data;
      return (
        !result?.error &&
        row?.enabled === true &&
        [
          row.user_day_cap_micros,
          row.user_month_cap_micros,
          row.global_day_cap_micros,
          row.global_month_cap_micros
        ].every(
          (value) =>
            Number.isSafeInteger(Number(value)) && Number(value) > 0
        )
      );
    } catch {
      return false;
    }
  }

  // Both the trial Router and the downstream candidate/checkpoint bridge
  // use this permission checker. A stop after a paid response blocks
  // candidate persistence but never skips Router budget settlement.
  async function trialPermission(args) {
    if (!(await runtimeActive())) return false;
    try {
      return (await permissionCheck(args)) === true;
    } catch {
      return false;
    }
  }

  async function verifyOwner(token) {
    if (
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/u.test(token)
    ) {
      denied();
    }
    const { data, error } = await authClient.auth.getUser(token);
    if (
      error ||
      typeof data?.user?.id !== 'string' ||
      data.user.id.toLowerCase() !== owner
    ) {
      denied();
    }
  }

  // The Router rechecks authorization on cache hits as well as new calls.
  // The bridge independently checks the novel, episode, session and consent
  // both before and after any provider call; this additional gate is not a
  // replacement for either check.
  async function authorize({ feature, principal, workId: novelId }, episodeId) {
    if (
      feature?.key !== 'novel-bible' ||
      principal?.id !== owner ||
      novelId < 1
    ) {
      return false;
    }
    const result = await serviceClient
      .from('novels')
      .select('id,user_id')
      .eq('id', novelId)
      .maybeSingle();
    if (
      result?.error ||
      result?.data?.id !== novelId ||
      result?.data?.user_id?.toLowerCase() !== owner
    ) {
      return false;
    }
    return (
      (await trialPermission({
        actorId: owner,
        novelId,
        episodeId,
        purpose: 'external-novel-bible-analysis'
      })) === true
    );
  }

  // Reuse exactly the existing authenticated owner/Router/repository
  // composition for both one-chunk staging and the non-paid plan inspection.
  // In particular, no author client or budget adapter exists before Auth.
  async function openOwnerBridge(token, episode) {
    // Do not instantiate any token-bound author client, Router, budget
    // adapter, model provider or repository before fresh owner Auth.
    await verifyOwner(token);
    const authorClient = await createAuthorClient({
      token,
      actorId: owner
    });
    if (
      !authorClient ||
      authorClient === serviceClient ||
      typeof authorClient.rpc !== 'function'
    ) {
      unavailable();
    }

    const repository = createSupabaseOwnerBibleReviewRepository({
      serviceClient,
      authorClient
    });
    const workflow = createOwnerBibleReviewWorkflow({
      enabled: true,
      ownerId: owner,
      authClient,
      serviceClient,
      repository
    });
    const router = createAiRouter({
      enabled: true,
      authorize: (context) => authorize(context, episode),
      beforeProviderAttempt: async (context) => {
        // A stop, revoked consent or changed owner during the budget RPC
        // must block the provider BEFORE the first network request.
        await verifyOwner(token);
        return authorize(context, episode);
      },
      budget: createSupabaseAiBudget({ serviceClient }),
      audit: createSupabaseAiAudit({ serviceClient }),
      providers,
      routes,
      cache
    });
    const bridge = createOwnerNovelBibleModelBridge({
      enabled: true,
      externalProcessingApproved: true,
      ownerId: owner,
      authClient,
      serviceClient,
      aiRouter: router,
      reviewWorkflow: workflow,
      permissionCheck: trialPermission,
      readVerifiedHistory: historyReader,
      checkpoint
    });

    return bridge;
  }

  return Object.freeze({
    async inspectPlan({ token, novelId, episodeId } = {}) {
      if (!enabled || externalProcessingApproved !== true) {
        throw new Error('AI_TRIAL_RUNTIME_DISABLED');
      }
      const work = workId(novelId);
      const episode = workId(episodeId);
      const bridge = await openOwnerBridge(token, episode);
      return bridge.inspectPlan({ token, novelId: work, episodeId: episode });
    },
    async stage({ token, novelId, episodeId, chunkIndex = 0 } = {}) {
      if (!enabled || externalProcessingApproved !== true) {
        throw new Error('AI_TRIAL_RUNTIME_DISABLED');
      }
      const work = workId(novelId);
      const episode = workId(episodeId);
      if (
        !Number.isSafeInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex > 63
      ) {
        denied();
      }
      const bridge = await openOwnerBridge(token, episode);
      return bridge.stage({
        token,
        novelId: work,
        episodeId: episode,
        chunkIndex
      });
    }
  });
}
