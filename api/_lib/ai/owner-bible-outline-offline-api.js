// Offline-only HTTP boundary for the existing owner-only outline reader.
// This module lives under api/_lib and is NOT a deployed Vercel API route.
// It never initializes Auth, Supabase, a DB connection or a model provider.
// A future explicitly approved server route must supply trusted capabilities;
// setting environment flags alone must never make this endpoint callable.
import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from '../admin-auth.js';
import { createOfflineOwnerBibleNavigation } from './owner-bible-offline-navigation.js';

function positiveId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Injected readOwnerPreview is a trusted SERVER-ONLY capability, never an
// object taken from query/body or a client-declared ownership claim.
// It must independently load the exact owner-only preview for this bearer.
export function createOfflineOwnerBibleOutlineApiHandler({
  env = process.env,
  enabled = false,
  readOwnerPreview,
  serviceClient,
  createAuthorClient,
  config,
  verifySignedClaims,
  lookupOneSession,
  nowEpochSeconds
} = {}) {
  const navigation = createOfflineOwnerBibleNavigation({
    serviceClient,
    createAuthorClient,
    config,
    previewEnabled: enabled === true,
    verifySignedClaims,
    lookupOneSession,
    nowEpochSeconds
  });

  return async function offlineOwnerBibleOutlineApi(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET');

    // This extra explicit switch stays false in any ordinary import/caller.
    // A public route does not import this module in the production app.
    if (
      enabled !== true ||
      env?.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
      env?.NOVELIGHT_AI_OWNER_OUTLINE_ENABLED !== 'true'
    ) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (req?.method !== 'GET') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const bearer = req.headers?.authorization;
    if (typeof bearer !== 'string' || !/^Bearer \S{16,4096}$/i.test(bearer)) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const novelId = positiveId(req.query?.novel_id);
    if (!novelId) return res.status(400).json({ error: 'INVALID_NOVEL_ID' });
    if (typeof readOwnerPreview !== 'function') {
      return res.status(503).json({ error: 'OUTLINE_UNAVAILABLE' });
    }

    try {
      // Never trust a preview or an outline supplied by the HTTP client.
      const preview = await readOwnerPreview({ bearer, novelId });
      if (
        !preview ||
        preview.novelId !== novelId ||
        preview.aiGenerated !== false ||
        !Array.isArray(preview.characters) ||
        !Array.isArray(preview.notes) ||
        !Array.isArray(preview.facts) ||
        Object.hasOwn(preview, 'candidates')
      ) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }

      // The existing adapter rechecks Auth/novel owner and the signed session
      // across both author-only RPC reads, then strips titles/draft state.
      const result = await navigation.read({
        bearer,
        expectedNovelId: novelId,
        preview
      });
      if (
        !result ||
        result.novelId !== novelId ||
        !Array.isArray(result.outlineRows)
      ) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      return res.status(200).json({
        novelId,
        aiGenerated: false,
        outlineRows: result.outlineRows
      });
    } catch {
      // No token, unpublished text, auth.sessions detail or raw error leaks.
      return res.status(503).json({ error: 'OUTLINE_UNAVAILABLE' });
    }
  };
}
