// Server-only offline composition for OWNER checklist durable persistence.
// NOT mounted under api/*.js, not imported by story-notes.html.
// Every required identity/session capability must be explicitly supplied.
// A real Supabase service client + privileged lookupOneSession must only be
// supplied after an independently scoped Staging/Production authorization.
import { createOfflineOwnerBibleReviewStateWorkflow } from './owner-bible-review-state-offline.js';
import { createOfflineOwnerBibleReviewStateApiHandler } from './owner-bible-review-state-offline-api.js';
import {
  createOwnerNovelBiblePreviewHandler,
  resolveOwnerNovelBiblePreviewConfig
} from './owner-novel-bible-preview.js';
import { createSupabaseOwnerBibleReviewStateRepository } from './owner-bible-review-state-repository.js';
import { createOfflineOwnerSessionCheck } from './owner-session-evidence.js';
import { createOfflinePrivateSessionReader } from './owner-private-session-reader.js';

function unavailable() {
  throw new Error('AI_OWNER_REVIEW_STATE_UNAVAILABLE');
}

export function createOfflineOwnerBibleReviewStateWiring({
  enabled = false,
  ownerId,
  serviceClient,
  readOwnerPreview,
  lookupOneSession,
  nowEpochSeconds
} = {}) {
  if (
    typeof serviceClient?.auth?.getClaims !== 'function' ||
    typeof serviceClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    typeof readOwnerPreview !== 'function' ||
    typeof lookupOneSession !== 'function' ||
    typeof nowEpochSeconds !== 'function'
  ) {
    unavailable();
  }
  const repository = createSupabaseOwnerBibleReviewStateRepository({
    serviceClient,
    checkSession: createOfflineOwnerSessionCheck({
      verifySignedClaims: (token) => serviceClient.auth.getClaims(token),
      readExistingSession: createOfflinePrivateSessionReader({
        lookupOneSession
      }),
      nowEpochSeconds
    })
  });

  return createOfflineOwnerBibleReviewStateWorkflow({
    enabled,
    ownerId,
    authClient: serviceClient,
    serviceClient,
    readOwnerPreview,
    repository
  });
}

/**
 * Compose the existing owner preview, signed session evidence and CAS review
 * workflow into one OFFLINE HTTP contract. This is deliberately NOT imported
 * from api/*.js; it cannot enable real storage, network or owner trials.
 * A privileged auth.sessions existence reader must be separately supplied.
 */
export function createOfflineOwnerBibleReviewStateHttpWiring({
  enabled = false,
  env = process.env,
  serviceClient,
  createAuthorClient,
  lookupOneSession,
  nowEpochSeconds
} = {}) {
  const disabled = () =>
    createOfflineOwnerBibleReviewStateApiHandler({ enabled: false, env });
  const config = resolveOwnerNovelBiblePreviewConfig(env);
  if (
    enabled !== true ||
    env?.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
    env?.NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED !== 'true' ||
    !config ||
    typeof serviceClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.auth?.getClaims !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    typeof createAuthorClient !== 'function' ||
    typeof lookupOneSession !== 'function' ||
    typeof nowEpochSeconds !== 'function'
  ) {
    return disabled();
  }

  // Reuse the established owner-only preview gate; never trust a browser
  // supplied preview, "approved" flag, novel owner or JWT claims object.
  const handlePreview = createOwnerNovelBiblePreviewHandler({
    serviceClient,
    createAuthorClient,
    env
  });
  const readOwnerPreview = async ({ actorId, novelId, token }) => {
    if (
      actorId !== config.id ||
      !Number.isSafeInteger(novelId) ||
      novelId < 1 ||
      typeof token !== 'string'
    ) {
      return null;
    }
    const reply = {
      statusCode: 503,
      body: null,
      setHeader() {
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    try {
      await handlePreview(
        {
          method: 'GET',
          headers: {
            authorization: 'Bearer ' + token,
            origin: 'https://offline.internal',
            host: 'offline.internal',
            'sec-fetch-site': 'same-origin'
          },
          query: { novel_id: String(novelId) }
        },
        reply
      );
    } catch {
      return null;
    }
    // Private preview content stays exclusively inside the server workflow.
    return reply.statusCode === 200 && reply.body?.novelId === novelId
      ? reply.body
      : null;
  };

  const workflow = createOfflineOwnerBibleReviewStateWiring({
    enabled: true,
    ownerId: config.id,
    serviceClient,
    readOwnerPreview,
    lookupOneSession,
    nowEpochSeconds
  });
  return createOfflineOwnerBibleReviewStateApiHandler({
    enabled: true,
    env,
    createWorkflow: () => workflow
  });
}
