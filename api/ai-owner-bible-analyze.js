// Phase 02-07-04: owner-only AI trial entrypoint, fail-closed by default.
// No real provider, budget adapter, external consent grant or trial runtime is
// attached. A separately approved server-only integration must supply all of
// these before this route can execute any inference or write any candidates.
import { createClient } from '@supabase/supabase-js';

import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from './_lib/admin-auth.js';
import {
  resolveOwnerNovelBiblePreviewConfig
} from './_lib/ai/owner-novel-bible-preview.js';

function fail(res, status, code) {
  return res.status(status).json({ error: code });
}

function positiveId(value) {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[1-9]\d*$/.test(String(value))
  ) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function requestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const keys = Object.keys(body);
  if (
    keys.length < 2 ||
    keys.length > 3 ||
    keys.some((key) => !['novelId', 'episodeId', 'chunkIndex'].includes(key))
  ) {
    return null;
  }
  const novelId = positiveId(body.novelId);
  const episodeId = positiveId(body.episodeId);
  const chunkIndex = body.chunkIndex ?? 0;
  if (
    !novelId ||
    !episodeId ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex > 63
  ) {
    return null;
  }
  return { novelId, episodeId, chunkIndex };
}

function bearerToken(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(\S{16,4096})$/i);
  return match?.[1] ?? null;
}

// This is intentionally NOT a production runtime builder. An undefined
// createTrialBridge always rejects; environment flags alone cannot make
// real or mock AI calls reachable from the deployed app.
export function createOwnerBibleAnalyzeApiHandler({
  env = process.env,
  createServiceClient = createClient,
  createTrialBridge = null
} = {}) {
  return async function ownerBibleAnalyzeApi(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'POST');

    if (
      env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_REVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_MODEL_TRIAL_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED !== 'true' ||
      env.NOVELIGHT_AI_ENABLED !== 'true'
    ) {
      return fail(res, 404, 'NOT_FOUND');
    }
    if (req.method !== 'POST') {
      return fail(res, 405, 'METHOD_NOT_ALLOWED');
    }
    // A real Origin and non-simple custom header are required. Do not treat
    // an absent Origin as proof that a write request is same-origin.
    if (
      typeof req.headers?.origin !== 'string' ||
      !isSameOriginRequest(req) ||
      req.headers['x-novelight-ai-trial'] !== '1' ||
      !/^application\/json(?:\s*;|$)/i.test(
        req.headers['content-type'] ?? ''
      )
    ) {
      return fail(res, 403, 'FORBIDDEN');
    }
    const token = bearerToken(req.headers.authorization);
    if (!token) return fail(res, 401, 'UNAUTHORIZED');

    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
    } catch {
      return fail(res, 400, 'INVALID_REQUEST');
    }
    if (size > 512) return fail(res, 413, 'PAYLOAD_TOO_LARGE');
    const input = requestBody(req.body);
    if (!input) return fail(res, 400, 'INVALID_REQUEST');

    const config = resolveOwnerNovelBiblePreviewConfig(env);
    if (
      !config ||
      typeof env.SUPABASE_SECRET_KEY !== 'string' ||
      !env.SUPABASE_SECRET_KEY ||
      typeof createTrialBridge !== 'function'
    ) {
      return fail(res, 503, 'AI_TRIAL_UNAVAILABLE');
    }

    try {
      const serviceClient = createServiceClient(
        config.url,
        env.SUPABASE_SECRET_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      if (typeof serviceClient?.auth?.getUser !== 'function') {
        return fail(res, 503, 'AI_TRIAL_UNAVAILABLE');
      }
      // Verify a fresh server-side Auth identity before constructing the
      // trial runner. The bridge independently rechecks owner, novel, episode,
      // current manuscript hash and author consent before and after AI calls.
      const identity = await serviceClient.auth.getUser(token);
      if (identity?.error || !identity?.data?.user?.id) {
        return fail(res, 401, 'UNAUTHORIZED');
      }
      if (identity.data.user.id.toLowerCase() !== config.id) {
        return fail(res, 404, 'NOT_FOUND');
      }

      const bridge = await createTrialBridge({
        ownerId: config.id,
        serviceClient
      });
      if (typeof bridge?.stage !== 'function') {
        return fail(res, 503, 'AI_TRIAL_UNAVAILABLE');
      }
      const outcome = await bridge.stage({ token, ...input });
      if (
        outcome?.novelId !== input.novelId ||
        !Number.isSafeInteger(outcome.stagedCount) ||
        outcome.stagedCount < 0 ||
        outcome.stagedCount > 12 ||
        outcome.requiresAuthorReview !== true
      ) {
        return fail(res, 503, 'AI_TRIAL_UNAVAILABLE');
      }
      // Strict response projection: never echo prompts, unpublished text,
      // provider output, credentials or private creative notes to browsers.
      return res.status(200).json({
        novelId: input.novelId,
        stagedCount: outcome.stagedCount,
        requiresAuthorReview: true
      });
    } catch (error) {
      if (
        [
          'AI_BIBLE_MODEL_BRIDGE_DISABLED',
          'AI_BIBLE_MODEL_BRIDGE_DENIED',
          'AI_OWNER_REVIEW_DENIED',
          'AI_ACCESS_DENIED'
        ].includes(error?.message)
      ) {
        return fail(res, 404, 'NOT_FOUND');
      }
      if (
        [
          'AI_BIBLE_CHUNK_INVALID',
          'AI_BIBLE_INFERENCE_INVALID',
          'AI_NOVEL_BIBLE_INVALID_SOURCE'
        ].includes(error?.message)
      ) {
        return fail(res, 409, 'STALE_REVIEW');
      }
      if (error?.message === 'AI_BUDGET_DENIED') {
        return fail(res, 429, 'AI_BUDGET_DENIED');
      }
      // Never log JWT, model text, cost backend errors or manuscript content.
      return fail(res, 503, 'AI_TRIAL_UNAVAILABLE');
    }
  };
}

export default createOwnerBibleAnalyzeApiHandler();
