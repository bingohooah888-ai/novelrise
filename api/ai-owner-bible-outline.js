// Owner-only chapter navigation route, deliberately OFF until an explicit
// server-side enablement and an independent session-existence capability exist.
// Reuses the already tested owner preview and scoped outline reader.
import { createClient } from '@supabase/supabase-js';
import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from './_lib/admin-auth.js';
import { createOfflineOwnerBibleOutlineWiring } from './_lib/ai/owner-bible-outline-offline-wiring.js';
import { resolveOwnerNovelBiblePreviewConfig } from './_lib/ai/owner-novel-bible-preview.js';

function unavailable(res) {
  return res.status(503).json({ error: 'OUTLINE_UNAVAILABLE' });
}

export function createOwnerBibleOutlineApiHandler({
  env = process.env,
  enabled = false,
  createServiceClient = createClient,
  createAuthorClient = createClient,
  lookupOneSession,
  nowEpochSeconds = () => Math.floor(Date.now() / 1000),
  createWiring = createOfflineOwnerBibleOutlineWiring
} = {}) {
  let handler = null;
  return async function ownerBibleOutline(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET');
    // Flags alone cannot enable this route; only a trusted server factory
    // supplying a real session observer can do that.
    if (
      enabled !== true ||
      env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_OWNER_OUTLINE_ENABLED !== 'true'
    ) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (req?.method !== 'GET') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (!/^Bearer \S{16,4096}$/i.test(req.headers?.authorization ?? '')) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (
      typeof lookupOneSession !== 'function' ||
      typeof nowEpochSeconds !== 'function' ||
      typeof createAuthorClient !== 'function' ||
      typeof createServiceClient !== 'function' ||
      typeof env.SUPABASE_SECRET_KEY !== 'string' ||
      !resolveOwnerNovelBiblePreviewConfig(env)
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
        handler = createWiring({
          enabled: true,
          env,
          serviceClient,
          createAuthorClient,
          lookupOneSession,
          nowEpochSeconds
        });
        if (typeof handler !== 'function') {
          handler = null;
          return unavailable(res);
        }
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

// Vercel imports this default: the endpoint remains permanently 404 until a
// separately approved integration explicitly supplies the trusted capabilities.
export default createOwnerBibleOutlineApiHandler();
