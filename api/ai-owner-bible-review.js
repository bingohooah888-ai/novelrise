// Owner-only review endpoint. Disabled by default. No model calls, no
// candidate generation, no manuscript upload and no author-canon writes.
import { createClient } from '@supabase/supabase-js';

import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from './_lib/admin-auth.js';
import { createOwnerBibleReviewWorkflow } from './_lib/ai/owner-bible-review-workflow.js';
import { createSupabaseOwnerBibleReviewRepository } from './_lib/ai/owner-bible-review-repository.js';
import { resolveOwnerNovelBiblePreviewConfig } from './_lib/ai/owner-novel-bible-preview.js';

function fail(res, status, code) {
  return res.status(status).json({ error: code });
}

function integerId(value) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function bearer(req) {
  const match =
    typeof req.headers?.authorization === 'string'
      ? req.headers.authorization.match(/^Bearer\s+(\S{16,4096})$/i)
      : null;
  return match?.[1] ?? null;
}

function actionBody(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 3 ||
    Object.keys(body).some(
      (key) => !['candidateId', 'expectedRevision', 'action'].includes(key)
    )
  ) {
    return null;
  }
  const candidateId = integerId(body.candidateId);
  if (
    !candidateId ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1 ||
    !['accept', 'reject'].includes(body.action)
  ) {
    return null;
  }
  return {
    candidateId,
    expectedRevision: body.expectedRevision,
    action: body.action
  };
}

export function createOwnerBibleReviewApiHandler({
  env = process.env,
  createServiceClient = createClient,
  createAuthorClient = createClient,
  createRepository = createSupabaseOwnerBibleReviewRepository,
  createWorkflow = createOwnerBibleReviewWorkflow
} = {}) {
  return async function ownerBibleReviewApi(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET, POST');
    if (
      env.NOVELIGHT_AI_REVIEW_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true'
    ) {
      return fail(res, 404, 'NOT_FOUND');
    }
    if (!['GET', 'POST'].includes(req.method)) {
      return fail(res, 405, 'METHOD_NOT_ALLOWED');
    }
    if (!isSameOriginRequest(req)) return fail(res, 403, 'FORBIDDEN');

    const token = bearer(req);
    if (!token) return fail(res, 401, 'UNAUTHORIZED');
    const novelId = integerId(req.query?.novel_id);
    if (!novelId) return fail(res, 400, 'INVALID_NOVEL_ID');

    let decision = null;
    if (req.method === 'POST') {
      // Browser must send the authenticated bearer and a non-simple custom
      // header. Require real same-origin Origin, not just absence of CORS.
      if (
        typeof req.headers?.origin !== 'string' ||
        req.headers['x-novelight-review'] !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
      ) {
        return fail(res, 403, 'FORBIDDEN');
      }
      if (JSON.stringify(req.body ?? null).length > 2048) {
        return fail(res, 413, 'PAYLOAD_TOO_LARGE');
      }
      decision = actionBody(req.body);
      if (!decision) return fail(res, 400, 'INVALID_ACTION');
    }

    const config = resolveOwnerNovelBiblePreviewConfig(env);
    if (!config || typeof env.SUPABASE_SECRET_KEY !== 'string') {
      return fail(res, 503, 'AI_REVIEW_UNAVAILABLE');
    }
    try {
      const serviceClient = createServiceClient(
        config.url,
        env.SUPABASE_SECRET_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const authorClient = createAuthorClient(config.url, config.key, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: 'Bearer ' + token } }
      });
      const repository = createRepository({
        serviceClient,
        authorClient
      });
      const workflow = createWorkflow({
        enabled: true,
        ownerId: config.id,
        authClient: serviceClient,
        serviceClient,
        repository
      });
      if (req.method === 'GET') {
        return res.status(200).json(await workflow.list({ token, novelId }));
      }
      return res.status(200).json(
        await workflow.decide({
          token,
          novelId,
          ...decision,
          explicitAuthorAction: true
        })
      );
    } catch (error) {
      if (
        error?.message === 'AI_OWNER_REVIEW_DENIED' ||
        error?.message === 'AI_ACCESS_DENIED'
      ) {
        return fail(res, 404, 'NOT_FOUND');
      }
      if (
        error?.message === 'AI_BIBLE_INFERENCE_INVALID' ||
        error?.message === 'AI_NOVEL_BIBLE_INVALID_SOURCE'
      ) {
        return fail(res, 409, 'STALE_REVIEW');
      }
      // Do not log bearer, unpublished excerpts, prompt text or model output.
      return fail(res, 503, 'AI_REVIEW_UNAVAILABLE');
    }
  };
}

export default createOwnerBibleReviewApiHandler();
