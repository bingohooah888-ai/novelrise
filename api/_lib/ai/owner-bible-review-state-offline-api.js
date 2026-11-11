// OFFLINE ONLY: no api/*.js imports this handler. No database, Supabase
// client, JWT verifier or provider is constructed in this module.
// Requires separately approved owner-authenticated repository + real route.
import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from '../admin-auth.js';
import { createOfflineOwnerBibleReviewStateWorkflow } from './owner-bible-review-state-offline.js';

function positiveId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function bearer(req) {
  const value = req?.headers?.authorization;
  if (typeof value !== 'string') return null;
  return value.match(/^Bearer (\S{16,4096})$/i)?.[1] ?? null;
}

function parseChange(req) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] ?? '')
  ) {
    return null;
  }
  const body = req.body;
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    !Object.hasOwn(body, 'expectedRevision') ||
    !Object.hasOwn(body, 'reviewedIds') ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    !Array.isArray(body.reviewedIds) ||
    body.reviewedIds.length > 100 ||
    body.reviewedIds.some(
      (id) => typeof id !== 'string' || !/^rv1-[0-9a-f]{16}$/.test(id)
    ) ||
    new Set(body.reviewedIds).size !== body.reviewedIds.length
  ) {
    return null;
  }
  return {
    expectedRevision: body.expectedRevision,
    reviewedIds: body.reviewedIds
  };
}

export function createOfflineOwnerBibleReviewStateApiHandler({
  enabled = false,
  env = process.env,
  ownerId,
  authClient,
  serviceClient,
  readOwnerPreview,
  repository
} = {}) {
  return async function ownerBibleReviewState(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET, POST');
    if (
      enabled !== true ||
      env?.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
      env?.NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED !== 'true'
    ) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (!['GET', 'POST'].includes(req?.method)) {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const novelId = positiveId(req.query?.novel_id);
    if (!novelId) return res.status(400).json({ error: 'INVALID_NOVEL_ID' });

    let change = null;
    if (req.method === 'POST') {
      // Same-Origin + explicit Origin and non-simple header prevents simple
      // cross-site POSTs. Never use a browser-supplied ownerId or preview.
      if (
        typeof req.headers?.origin !== 'string' ||
        req.headers?.['x-novelight-review-state'] !== '1'
      ) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      let bodyBytes;
      try {
        bodyBytes = Buffer.byteLength(JSON.stringify(req.body ?? null));
      } catch {
        return res.status(400).json({ error: 'INVALID_REVIEW_STATE' });
      }
      if (bodyBytes > 4096) {
        return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' });
      }
      change = parseChange(req);
      if (!change) {
        return res.status(400).json({ error: 'INVALID_REVIEW_STATE' });
      }
    }

    try {
      const workflow = createOfflineOwnerBibleReviewStateWorkflow({
        enabled: true,
        ownerId,
        authClient,
        serviceClient,
        readOwnerPreview,
        repository
      });
      const result =
        req.method === 'GET'
          ? await workflow.read({ token, novelId })
          : await workflow.save({
              token,
              novelId,
              ...change,
              explicitAuthorAction: true
            });
      return res.status(200).json(result);
    } catch (error) {
      const code = error?.message;
      if (code === 'AI_OWNER_REVIEW_STATE_DENIED') {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      if (
        code === 'AI_OWNER_REVIEW_STATE_CONFLICT' ||
        code === 'AI_OWNER_REVIEW_STATE_STALE'
      ) {
        return res.status(409).json({ error: 'REVIEW_STATE_CONFLICT' });
      }
      // Never return auth data, manuscript, candidate text or raw errors.
      return res.status(503).json({ error: 'REVIEW_STATE_UNAVAILABLE' });
    }
  };
}
