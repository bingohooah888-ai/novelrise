// Owner-only checklist persistence route, OFF until separately approved live
// session attestation and CAS storage are available. No schema changes here.
import { createClient } from '@supabase/supabase-js';
import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from './_lib/admin-auth.js';
import {
  createOwnerNovelBiblePreviewHandler,
  resolveOwnerNovelBiblePreviewConfig
} from './_lib/ai/owner-novel-bible-preview.js';
import { createOfflineOwnerBibleReviewStateApiHandler } from './_lib/ai/owner-bible-review-state-offline-api.js';
import { createSupabaseOwnerBibleReviewStateRepository } from './_lib/ai/owner-bible-review-state-repository.js';
import { createOfflineOwnerSessionCheck } from './_lib/ai/owner-session-evidence.js';
import { createOfflinePrivateSessionReader } from './_lib/ai/owner-private-session-reader.js';
import { createOfflineServiceRoleSessionLookup } from './_lib/ai/owner-service-role-session-reader.js';

function unavailable(res) {
  return res.status(503).json({ error: 'REVIEW_STATE_UNAVAILABLE' });
}

function capturedResponse() {
  return {
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
}

export function createOwnerBibleReviewStateApiHandler({
  env = process.env,
  enabled = false,
  createServiceClient = createClient,
  createAuthorClient = createClient,
  lookupOneSession,
  sessionLookupMode,
  nowEpochSeconds = () => Math.floor(Date.now() / 1000)
} = {}) {
  let handler = null;
  return async function ownerBibleReviewState(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET, POST');
    if (
      enabled !== true ||
      env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED !== 'true'
    ) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (!['GET', 'POST'].includes(req?.method)) {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (!/^Bearer \S{16,4096}$/i.test(req.headers?.authorization ?? '')) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (
      typeof req.query?.novel_id !== 'string' ||
      !/^[1-9]\d*$/.test(req.query.novel_id) ||
      !Number.isSafeInteger(Number(req.query.novel_id))
    ) {
      return res.status(400).json({ error: 'INVALID_NOVEL_ID' });
    }
    // Production stays OFF. Restricted RPC is an explicitly selected
    // Staging-only server dependency, never a browser-provided option.
    if (
      (typeof lookupOneSession !== 'function' &&
        sessionLookupMode !== 'restricted_rpc') ||
      (lookupOneSession !== undefined && sessionLookupMode !== undefined) ||
      (sessionLookupMode !== undefined &&
        sessionLookupMode !== 'restricted_rpc') ||
      typeof nowEpochSeconds !== 'function' ||
      typeof createServiceClient !== 'function' ||
      typeof createAuthorClient !== 'function' ||
      !env.SUPABASE_SECRET_KEY
    ) {
      return unavailable(res);
    }
    const config = resolveOwnerNovelBiblePreviewConfig(env);
    if (!config) return unavailable(res);
    if (
      sessionLookupMode === 'restricted_rpc' &&
      config.url !== 'https://wmlzjgvxgoyrovdhbqbg.supabase.co'
    ) {
      return unavailable(res);
    }
    if (!handler) {
      try {
        const serviceClient = createServiceClient(
          env.SUPABASE_URL,
          env.SUPABASE_SECRET_KEY,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        if (
          typeof serviceClient?.auth?.getUser !== 'function' ||
          typeof serviceClient?.auth?.getClaims !== 'function' ||
          typeof serviceClient?.from !== 'function' ||
          typeof serviceClient?.rpc !== 'function'
        ) {
          return unavailable(res);
        }
        const preview = createOwnerNovelBiblePreviewHandler({
          serviceClient,
          createAuthorClient,
          env
        });
        const sessionLookup =
          typeof lookupOneSession === 'function'
            ? lookupOneSession
            : createOfflineServiceRoleSessionLookup({ serviceClient });
        const repository = createSupabaseOwnerBibleReviewStateRepository({
          serviceClient,
          checkSession: createOfflineOwnerSessionCheck({
            verifySignedClaims: (token) => serviceClient.auth.getClaims(token),
            readExistingSession: createOfflinePrivateSessionReader({
              lookupOneSession: sessionLookup
            }),
            nowEpochSeconds
          })
        });
        handler = createOfflineOwnerBibleReviewStateApiHandler({
          enabled: true,
          env,
          ownerId: config.id,
          authClient: serviceClient,
          serviceClient,
          repository,
          readOwnerPreview: async ({ actorId, novelId, token }) => {
            if (actorId !== config.id) return null;
            const reply = capturedResponse();
            try {
              await preview(
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
            return reply.statusCode === 200 ? reply.body : null;
          }
        });
      } catch {
        handler = null;
        return unavailable(res);
      }
    }
    try {
      return await handler(req, res);
    } catch {
      return unavailable(res);
    }
  };
}

// Vercel uses the default: no session observer, no enablement, HTTP 404.
export default createOwnerBibleReviewStateApiHandler();
