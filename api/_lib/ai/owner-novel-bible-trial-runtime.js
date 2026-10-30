// Phase 02-07-04: dormant server-only composition for an owner AI trial.
// Never imported by a public API. No env switches, keys, provider selection,
// consent grants, budget increases or schema changes are supplied here.
// Live activation requires a separately approved runtime, authenticated
// author-JWT adapter, explicit consent and atomic budget/storage verification.
import { createOwnerBibleReviewWorkflow } from './owner-bible-review-workflow.js';
import { createSupabaseOwnerBibleReviewRepository } from './owner-bible-review-repository.js';
import { createOwnerNovelBibleModelBridge } from './owner-novel-bible-model-bridge.js';
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
    !providers ||
    !routes
  ) {
    unavailable();
  }
  const owner = ownerId.toLowerCase();

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
      (await permissionCheck({
        actorId: owner,
        novelId,
        episodeId,
        purpose: 'external-novel-bible-analysis'
      })) === true
    );
  }

  return Object.freeze({
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
        permissionCheck
      });
      // Only the bridge sees the request. It must independently verify the
      // live episode and consent and validate all evidence before staging.
      return bridge.stage({
        token,
        novelId: work,
        episodeId: episode,
        chunkIndex
      });
    }
  });
}
