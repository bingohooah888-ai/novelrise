// NOVELIGHT AI Phase 3, owner-only read route. Safe default is 404.
// Mounting this route does NOT activate AI providers or the admin trial.
import { createClient } from '@supabase/supabase-js';

import { applyAdminSecurityHeaders } from './_lib/admin-auth.js';
import { createOwnerNovelBiblePreviewHandler } from './_lib/ai/owner-novel-bible-preview.js';

export function createOwnerNovelBibleApiHandler({
  env = process.env,
  createServiceClient = createClient
} = {}) {
  let innerHandler = null;
  return async function ownerNovelBibleApi(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true') {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!innerHandler) {
      // Do not even initialize a service-role client until the separate
      // owner-preview enablement gate is deliberately configured.
      if (
        !env.SUPABASE_URL ||
        !env.SUPABASE_SECRET_KEY ||
        !env.NOVELIGHT_AI_ADMIN_USER_ID
      ) {
        return res.status(503).json({ error: 'AI_PREVIEW_UNAVAILABLE' });
      }
      try {
        const serviceClient = createServiceClient(
          env.SUPABASE_URL,
          env.SUPABASE_SECRET_KEY,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        innerHandler = createOwnerNovelBiblePreviewHandler({
          serviceClient,
          env
        });
      } catch {
        return res.status(503).json({ error: 'AI_PREVIEW_UNAVAILABLE' });
      }
    }
    return innerHandler(req, res);
  };
}

export default createOwnerNovelBibleApiHandler();
