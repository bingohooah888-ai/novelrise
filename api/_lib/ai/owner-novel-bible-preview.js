// Phase 2 internal read-only factory; deliberately NOT mounted as an API route.
// No author UI, paid AI calls, DB mutations, or public exposure in this change.
import { URL } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { applyAdminSecurityHeaders, isSameOriginRequest } from '../admin-auth.js';
import { groupNovelBibleFacts } from './novel-bible.js';
import { AiStorageError, createSupabaseAiBible } from './supabase-store.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseWorkId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parsePublicKey(value) {
  if (typeof value !== 'string' || value.length > 3000) return null;
  if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(value)) return value;
  if (!/^eyJ[a-zA-Z0-9_.-]+$/.test(value)) return null;
  try {
    const body = value.split('.')[1];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return claims.role === 'anon' ? value : null;
  } catch {
    return null;
  }
}

export function resolveOwnerNovelBiblePreviewConfig(env) {
  const id = env.NOVELIGHT_AI_ADMIN_USER_ID;
  const key = parsePublicKey(
    env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY
  );
  try {
    const url = new URL(env.SUPABASE_URL);
    if (
      typeof id !== 'string' ||
      !UUID.test(id) ||
      !key ||
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.supabase.co') ||
      url.username ||
      url.password ||
      url.pathname !== '/'
    ) {
      return null;
    }
    // Dedicated read-only trial identity never grants site-wide admin rights.
    return { id: id.toLowerCase(), url: url.origin, key };
  } catch {
    return null;
  }
}

function fail(res, code, message) {
  return res.status(code).json({ error: message });
}

// This endpoint's privilege is narrower than global administrator access.
// Verify a bearer with Supabase Auth and match exactly one configured user.
async function requireNovelBiblePreviewOwner(req, res, supabase, ownerId) {
  if (!isSameOriginRequest(req)) {
    fail(res, 403, 'Forbidden');
    return null;
  }
  const authorization = req.headers?.authorization;
  const bearer =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S{16,4096})$/i)
      : null;
  if (!bearer) {
    fail(res, 401, 'Unauthorized');
    return null;
  }
  const { data, error } = await supabase.auth.getUser(bearer[1]);
  if (error || typeof data?.user?.id !== 'string') {
    fail(res, 401, 'Unauthorized');
    return null;
  }
  if (data.user.id.toLowerCase() !== ownerId) {
    fail(res, 404, 'NOT_FOUND');
    return null;
  }
  return data.user;
}

// The dedicated preview ID never modifies global administrator privileges.
// Work ownership is additionally verified in the storage service.
export function createOwnerNovelBiblePreviewHandler({
  serviceClient,
  env = process.env,
  createAuthorClient = createClient
} = {}) {
  if (
    typeof serviceClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    typeof createAuthorClient !== 'function'
  ) {
    throw new AiStorageError();
  }

  return async function ownerNovelBiblePreview(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('Allow', 'GET');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED');

    // The unfinished feature remains hidden unless a future, separately
    // approved integration explicitly configures the owner preview.
    if (env.NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED !== 'true') {
      return fail(res, 404, 'NOT_FOUND');
    }
    const config = resolveOwnerNovelBiblePreviewConfig(env);
    if (!config) return fail(res, 503, 'AI_PREVIEW_UNAVAILABLE');

    let owner;
    try {
      owner = await requireNovelBiblePreviewOwner(req, res, serviceClient, config.id);
    } catch {
      return fail(res, 503, 'AI_PREVIEW_UNAVAILABLE');
    }
    if (!owner) return;
    const novelId = parseWorkId(req.query?.novel_id);
    if (!novelId) return fail(res, 400, 'INVALID_NOVEL_ID');
    const authHeader = req.headers?.authorization;
    if (
      typeof authHeader !== 'string' ||
      !/^Bearer [^\s]{16,4096}$/i.test(authHeader)
    ) {
      return fail(res, 401, 'UNAUTHORIZED');
    }

    try {
      // Public key + server-verified bearer, never service-role credentials:
      // Chapter 43 owner-only RPCs must see the author's JWT via auth.uid().
      const authorClient = createAuthorClient(config.url, config.key, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: authHeader } }
      });
      if (!authorClient || authorClient === serviceClient) {
        throw new AiStorageError();
      }
      const bible = createSupabaseAiBible({ serviceClient, authorClient });
      const actorId = owner.id;
      const canon = await bible.listOwnerCanon({ actorId, novelId });
      const facts = await bible.listOwnerFacts({ actorId, novelId });
      const grouped = groupNovelBibleFacts({
        principal: { id: actorId },
        novel: { id: novelId, user_id: actorId },
        facts
      });
      return res.status(200).json({
        novelId,
        characters: canon.characters,
        notes: canon.notes,
        facts: grouped.groups,
        aiGenerated: false
      });
    } catch (error) {
      if (error?.message === 'AI_ACCESS_DENIED') {
        return fail(res, 404, 'NOT_FOUND');
      }
      // No manuscript content, JWT, private notes or model output in logs.
      return fail(res, 503, 'AI_PREVIEW_UNAVAILABLE');
    }
  };
}
