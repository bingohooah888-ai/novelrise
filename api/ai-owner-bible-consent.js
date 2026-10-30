// Owner-only consent transport, dormant unless separately approved server
// settings, valid disclosures, owner Auth and scoped DB RPCs ALL exist.
// No manuscript inference, model entitlement or feature-publication is wired.
import { createClient } from '@supabase/supabase-js';

import {
  applyAdminSecurityHeaders,
  isSameOriginRequest
} from './_lib/admin-auth.js';
import { resolveOwnerNovelBiblePreviewConfig } from './_lib/ai/owner-novel-bible-preview.js';
import {
  createOwnerNovelBibleConsentRuntime,
  resolveOwnerNovelBibleConsentRuntimePolicy
} from './_lib/ai/owner-novel-bible-consent-runtime.js';

const PROCESSORS = new Set(['openai', 'gemini']);
const REVISION = /^[a-z0-9][a-z0-9._-]{3,119}$/i;

function fail(res, code, reason) {
  return res.status(code).json({ error: reason });
}

function positiveId(value) {
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function bearer(value) {
  if (typeof value !== 'string') return null;
  return value.match(/^Bearer\s+(\S{16,4096})$/i)?.[1] ?? null;
}

function actionBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  const action = body.action;
  if (
    !['grant', 'revoke'].includes(action) ||
    !PROCESSORS.has(body.processor) ||
    keys.some(
      (key) =>
        ![
          'action',
          'processor',
          'policyRevision',
          'acceptedExternalProcessing'
        ].includes(key)
    )
  ) {
    return null;
  }
  if (action === 'revoke') {
    if (keys.length !== 2) return null;
    return { action, processor: body.processor };
  }
  if (
    keys.length !== 4 ||
    typeof body.policyRevision !== 'string' ||
    !REVISION.test(body.policyRevision) ||
    body.acceptedExternalProcessing !== true
  ) {
    return null;
  }
  return {
    action,
    processor: body.processor,
    policyRevision: body.policyRevision
  };
}

function bounded(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validView(data, novelId) {
  if (
    data?.novelId !== novelId ||
    data?.aiEnabled !== false ||
    !REVISION.test(data.policyRevision ?? '') ||
    !Array.isArray(data.disclosures) ||
    data.disclosures.length < 1 ||
    data.disclosures.length > 2
  ) {
    return false;
  }
  const seen = new Set();
  for (const item of data.disclosures) {
    if (
      !PROCESSORS.has(item?.processor) ||
      seen.has(item.processor) ||
      !bounded(item.label, 80) ||
      !bounded(item.purpose, 240) ||
      !bounded(item.dataSent, 800) ||
      !bounded(item.retention, 800) ||
      !bounded(item.internationalTransfer, 800) ||
      !['none', 'active', 'revoked'].includes(item.status) ||
      (item.status === 'active' &&
        (typeof item.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(item.expiresAt)))) ||
      (item.status !== 'active' && item.expiresAt !== null)
    ) {
      return false;
    }
    seen.add(item.processor);
  }
  return true;
}

function validResult(result, novelId, input) {
  const expected = input.action === 'grant' ? 'granted' : 'revoked';
  return (
    result?.novelId === novelId &&
    result?.processor === input.processor &&
    result?.status === expected &&
    result?.aiEnabled === false &&
    (expected !== 'granted' ||
      (result.policyRevision === input.policyRevision &&
        typeof result.expiresAt === 'string' &&
        Number.isFinite(Date.parse(result.expiresAt))))
  );
}

export function createOwnerBibleConsentApiHandler({
  env = process.env,
  createServiceClient = createClient,
  createConsentRuntime = null
} = {}) {
  return async function ownerBibleConsentApi(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Allow', 'GET, POST');

    if (
      env.NOVELIGHT_AI_CONSENT_UI_ENABLED !== 'true' ||
      env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true'
    ) {
      return fail(res, 404, 'NOT_FOUND');
    }
    if (!['GET', 'POST'].includes(req.method)) {
      return fail(res, 405, 'METHOD_NOT_ALLOWED');
    }
    if (!isSameOriginRequest(req)) return fail(res, 403, 'FORBIDDEN');

    if (req.method === 'POST') {
      if (
        typeof req.headers?.origin !== 'string' ||
        req.headers['x-novelight-ai-consent'] !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
      ) {
        return fail(res, 403, 'FORBIDDEN');
      }
    }
    const token = bearer(req.headers?.authorization);
    if (!token) return fail(res, 401, 'UNAUTHORIZED');

    const novelId = positiveId(req.query?.novel_id);
    if (!novelId) return fail(res, 400, 'INVALID_NOVEL_ID');

    let input = null;
    if (req.method === 'POST') {
      try {
        if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > 512) {
          return fail(res, 413, 'PAYLOAD_TOO_LARGE');
        }
      } catch {
        return fail(res, 400, 'INVALID_ACTION');
      }
      input = actionBody(req.body);
      if (!input) return fail(res, 400, 'INVALID_ACTION');
    }

    const config = resolveOwnerNovelBiblePreviewConfig(env);
    const approvedPolicy =
      typeof createConsentRuntime === 'function'
        ? null
        : resolveOwnerNovelBibleConsentRuntimePolicy(env);
    if (
      !config ||
      !bounded(env.SUPABASE_SECRET_KEY, 2048) ||
      (typeof createConsentRuntime !== 'function' && !approvedPolicy)
    ) {
      return fail(res, 503, 'AI_CONSENT_UNAVAILABLE');
    }

    try {
      const serviceClient = createServiceClient(
        config.url,
        env.SUPABASE_SECRET_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const identity = await serviceClient?.auth?.getUser?.(token);
      if (identity?.error || typeof identity?.data?.user?.id !== 'string') {
        return fail(res, 401, 'UNAUTHORIZED');
      }
      if (identity.data.user.id.toLowerCase() !== config.id) {
        return fail(res, 404, 'NOT_FOUND');
      }

      const runtime =
        typeof createConsentRuntime === 'function'
          ? await createConsentRuntime({
              ownerId: config.id,
              serviceClient
            })
          : createOwnerNovelBibleConsentRuntime({
              enabled: true,
              ownerId: config.id,
              serviceClient,
              policyRevision: approvedPolicy.policyRevision,
              disclosures: approvedPolicy.disclosures
            });
      if (
        typeof runtime?.read !== 'function' ||
        typeof runtime?.grant !== 'function' ||
        typeof runtime?.revoke !== 'function'
      ) {
        return fail(res, 503, 'AI_CONSENT_UNAVAILABLE');
      }

      if (req.method === 'GET') {
        const view = await runtime.read({ token, novelId });
        if (!validView(view, novelId)) {
          return fail(res, 503, 'AI_CONSENT_UNAVAILABLE');
        }
        return res.status(200).json({
          novelId,
          policyRevision: view.policyRevision,
          aiEnabled: false,
          disclosures: view.disclosures.map((item) => ({
            processor: item.processor,
            label: item.label,
            purpose: item.purpose,
            dataSent: item.dataSent,
            retention: item.retention,
            internationalTransfer: item.internationalTransfer,
            status: item.status,
            expiresAt: item.expiresAt
          }))
        });
      }

      const params = {
        token,
        novelId,
        processor: input.processor,
        explicitAuthorAction: true
      };
      const outcome =
        input.action === 'grant'
          ? await runtime.grant({
              ...params,
              acceptedExternalProcessing: true,
              acceptedDisclosureRevision: input.policyRevision
            })
          : await runtime.revoke(params);
      if (!validResult(outcome, novelId, input)) {
        return fail(res, 503, 'AI_CONSENT_UNAVAILABLE');
      }
      return res.status(200).json({
        novelId,
        processor: input.processor,
        status: outcome.status,
        aiEnabled: false,
        ...(input.action === 'grant'
          ? {
              policyRevision: outcome.policyRevision,
              expiresAt: outcome.expiresAt
            }
          : {})
      });
    } catch (error) {
      if (error?.message === 'AI_CONSENT_ACTION_DENIED') {
        return fail(res, 404, 'NOT_FOUND');
      }
      // Never log tokens, manuscripts, model prompts or DB details.
      return fail(res, 503, 'AI_CONSENT_UNAVAILABLE');
    }
  };
}

export default createOwnerBibleConsentApiHandler();
