// Phase 02-07-04: owner-only AI trial entrypoint, fail-closed by default.
// The live bridge is null unless separately approved and tightly scoped.
// Importing this route does not enable models, budgets or external processing.
import { createClient } from '@supabase/supabase-js';

import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from './_lib/admin-auth.js';
import { resolveOwnerNovelBiblePreviewConfig } from './_lib/ai/owner-novel-bible-preview.js';
import { createOwnerNovelBibleLiveTrialBridge } from './_lib/ai/owner-novel-bible-trial-live.js';
import { createOwnerNovelBibleConsentPermissionCheck } from './_lib/ai/owner-novel-bible-consent.js';
import { resolveOwnerNovelBibleConsentRuntimePolicy } from './_lib/ai/owner-novel-bible-consent-runtime.js';

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

// Read-only readiness: fresh Auth, scoped grants and durable limits.
// It never invokes a model, reserves money or writes candidates.
// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
async function ownerTrialReadiness({ env, client, ownerId, novelId }) {
  const allowedNovel = positiveId(env.NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID);
  const allowedEpisode = positiveId(env.NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID);
  if (!allowedNovel || novelId !== allowedNovel || !allowedEpisode) return null;
  try {
    const policy = resolveOwnerNovelBibleConsentRuntimePolicy(env);
    const selected = JSON.parse(env.NOVELIGHT_AI_TRIAL_ROUTES_JSON);
    if (!policy || !Array.isArray(selected)) return null;
    const permissionCheck = createOwnerNovelBibleConsentPermissionCheck({
      enabled: true,
      ownerId,
      serviceClient: client,
      routes: { 'novel-bible': selected },
      policyRevision: policy.policyRevision
    });
    if (
      (await permissionCheck({
        actorId: ownerId,
        novelId,
        episodeId: allowedEpisode,
        purpose: 'external-novel-bible-analysis'
      })) !== true
    ) {
      return null;
    }
    // No readiness if the server-side global kill switch or any cap is zero.
    const result = await client
      .from('novelight_ai_runtime_settings')
      .select(
        'enabled,user_day_cap_micros,user_month_cap_micros,' +
          'global_day_cap_micros,global_month_cap_micros'
      )
      .eq('singleton', 1)
      .maybeSingle();
    const row = result?.data;
    const limits = [
      row?.user_day_cap_micros,
      row?.user_month_cap_micros,
      row?.global_day_cap_micros,
      row?.global_month_cap_micros
    ];
    if (
      result?.error ||
      row?.enabled !== true ||
      limits.some(
        (value) =>
          !Number.isSafeInteger(Number(value)) || Number(value) <= 0
      )
    ) {
      return null;
    }
    return { novelId, episodeId: allowedEpisode, chunkIndex: 0 };
  } catch {
    return null;
  }
}

function bearerToken(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(\S{16,4096})$/i);
  return match?.[1] ?? null;
}

// This is intentionally NOT a production runtime builder. An undefined
// createTrialBridge always rejects; environment flags alone cannot make
// real or mock AI calls reachable from the deployed app.
// Preserve the fully specified fail-closed test/HTTP boundary.
// prettier-ignore
export function createOwnerBibleAnalyzeApiHandler({
  env = process.env,
  createServiceClient = createClient,
  createTrialBridge = null
} = {}) {
  return async function ownerBibleAnalyzeApi(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET, POST');

    if (
      env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_REVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_MODEL_TRIAL_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED !== 'true' ||
      env.NOVELIGHT_AI_ENABLED !== 'true'
    ) {
      return fail(res, 404, 'NOT_FOUND');
    }
    const readiness =
      req.method === 'GET' &&
      req.headers?.['x-novelight-ai-trial-status'] === '1';
    if (req.method !== 'POST' && !readiness) {
      return fail(res, 405, 'METHOD_NOT_ALLOWED');
    }
    if (!isSameOriginRequest(req)) {
      return fail(res, 403, 'FORBIDDEN');
    }
    // Writes require a real Origin and a non-simple trial header.
    if (
      !readiness &&
      (typeof req.headers?.origin !== 'string' ||
        req.headers['x-novelight-ai-trial'] !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    ) {
      return fail(res, 403, 'FORBIDDEN');
    }
    const token = bearerToken(req.headers?.authorization);
    if (!token) return fail(res, 401, 'UNAUTHORIZED');

    let input;
    if (readiness) {
      const novelId = positiveId(req.query?.novel_id);
      if (!novelId) return fail(res, 400, 'INVALID_REQUEST');
      input = { novelId };
    } else {
      let size;
      try {
        size = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
      } catch {
        return fail(res, 400, 'INVALID_REQUEST');
      }
      if (size > 512) return fail(res, 413, 'PAYLOAD_TOO_LARGE');
      input = requestBody(req.body);
      if (!input) return fail(res, 400, 'INVALID_REQUEST');
    }

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

      if (readiness) {
        const approved = await ownerTrialReadiness({
          env,
          client: serviceClient,
          ownerId: config.id,
          novelId: input.novelId
        });
        if (!approved) return fail(res, 404, 'NOT_FOUND');
        return res.status(200).json({ ...approved, trialReady: true });
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

// No flags, policies, scope, provider keys or approved spend => null bridge.
// This declaration does NOT grant consent or change the database kill switch.
export default createOwnerBibleAnalyzeApiHandler({
  createTrialBridge: createOwnerNovelBibleLiveTrialBridge()
});
