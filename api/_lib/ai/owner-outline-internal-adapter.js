// AI phase 2, UNMOUNTED server-internal future adapter.
// No route imports this file. Never run against live JWT, RPC or DB without
// separate staging approval, including consent/entitlement and environment proof.
// This reuses the owner-preview pattern: verified bearer -> owner-only novels
// lookup -> publishable-key author client -> scoped novelight_novel_outline RPC.
// This module does not check live logout/revocation by itself; a FUTURE trusted
// server-side checkSession observer is mandatory and must reject stale sessions.
import { Buffer } from 'node:buffer';

import { validateOwnerOutlineReadWindow } from './owner-outline-read-window.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positive(value) {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
  )
    return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function ownerId(value) {
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

// Match the current owner-preview allowlist. A legacy service-role JWT must
// never be used as the browser-bound author client's Supabase API key.
function publishableKey(value) {
  if (typeof value !== 'string' || value.length > 3000) return false;
  if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(value)) return true;
  if (!/^eyJ[a-zA-Z0-9_.-]+$/.test(value)) return false;
  try {
    const encoded = value.split('.')[1];
    const claims = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );
    return claims.role === 'anon';
  } catch {
    return false;
  }
}

export function createOwnerOutlineInternalAdapter({
  serviceClient,
  createAuthorClient,
  config,
  checkSession,
  previewEnabled = false
} = {}) {
  // These are trusted server dependencies, never supplied by the browser.
  const configuredOwner = ownerId(config?.id);
  const url = config?.url;
  const key = config?.key;
  const validConfig =
    configuredOwner &&
    typeof url === 'string' &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
    publishableKey(key);

  function validRpcRows(rows) {
    // The existing outline RPC returns only its declared seven columns,
    // never novel_id. Reject scope-bearing extras rather than silently
    // trusting an unexpected envelope as the requested work.
    return (
      Array.isArray(rows) &&
      rows.every(
        (row) =>
          row &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          !Object.hasOwn(row, 'novel_id')
      )
    );
  }

  return Object.freeze({
    async read({ bearer, expectedNovelId, preview } = {}) {
      const work = positive(expectedNovelId);
      const match =
        typeof bearer === 'string'
          ? /^Bearer (\S{16,4096})$/i.exec(bearer)
          : null;
      if (
        previewEnabled !== true ||
        !validConfig ||
        !work ||
        !match ||
        typeof serviceClient?.auth?.getUser !== 'function' ||
        typeof serviceClient?.from !== 'function' ||
        typeof serviceClient?.rpc !== 'function' ||
        typeof createAuthorClient !== 'function' ||
        typeof checkSession !== 'function' ||
        !preview ||
        preview.novelId !== work ||
        preview.aiGenerated !== false ||
        Object.hasOwn(preview, 'candidates')
      )
        return null;

      const token = match[1];
      let before = null;
      let after = null;
      let authorClient = null;

      // Re-check the authenticated user and the exact novel owner, not a
      // client-declared owner. The service client NEVER runs the outline RPC.
      async function verifiedOwner() {
        const { data: userData, error: authError } =
          await serviceClient.auth.getUser(token);
        const verifiedActorId = ownerId(userData?.user?.id);
        if (
          authError ||
          !verifiedActorId ||
          verifiedActorId !== configuredOwner
        )
          return null;

        const { data: novel, error: novelError } = await serviceClient
          .from('novels')
          .select('id,user_id')
          .eq('id', work)
          .maybeSingle();
        if (
          novelError ||
          !novel ||
          positive(novel.id) !== work ||
          ownerId(novel.user_id) !== verifiedActorId
        )
          return null;
        return { actorId: verifiedActorId };
      }

      // This callback must be backed by a future trusted server-side session
      // status check. Supabase getUser alone does not prove that an access
      // token was invalidated when the browser signed out.
      async function observedSession(actorId) {
        const observation = await checkSession({
          bearerToken: token,
          actorId,
          novelId: work
        });
        if (
          !observation ||
          observation.active !== true ||
          typeof observation.binding !== 'string' ||
          !observation.binding ||
          observation.binding.length > 128
        )
          return null;
        return observation.binding;
      }

      try {
        const first = await verifiedOwner();
        if (!first) return null;
        const firstBinding = await observedSession(first.actorId);
        if (!firstBinding) return null;

        authorClient = createAuthorClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: 'Bearer ' + token } }
        });
        if (
          !authorClient ||
          authorClient === serviceClient ||
          typeof authorClient.rpc !== 'function'
        )
          return null;

        // The existing SQL RPC requires auth.uid() and scopes every row to
        // p_novel_id. An anon/service-role RPC must not substitute here.
        const firstRead = await authorClient.rpc('novelight_novel_outline', {
          p_novel_id: work
        });
        if (firstRead?.error || !validRpcRows(firstRead?.data)) return null;
        before = firstRead.data;

        const middleBinding = await observedSession(first.actorId);
        if (middleBinding !== firstBinding) return null;

        const secondRead = await authorClient.rpc('novelight_novel_outline', {
          p_novel_id: work
        });
        if (secondRead?.error || !validRpcRows(secondRead?.data)) return null;
        after = secondRead.data;

        const last = await verifiedOwner();
        if (!last || last.actorId !== first.actorId) return null;
        const lastBinding = await observedSession(last.actorId);
        if (lastBinding !== firstBinding) return null;

        return validateOwnerOutlineReadWindow({
          expectedNovelId: work,
          preview,
          accessBefore: {
            verifiedActorId: first.actorId,
            checkedNovelOwnerId: first.actorId,
            checkedNovelId: work,
            sessionBinding: firstBinding
          },
          accessAfter: {
            verifiedActorId: last.actorId,
            checkedNovelOwnerId: last.actorId,
            checkedNovelId: work,
            sessionBinding: lastBinding
          },
          outlineBefore: before,
          outlineAfter: after
        });
      } catch {
        // Never disclose JWT, private draft rows, auth response or error
        // details. A failed or ambiguous request must not return old data.
        return null;
      } finally {
        before = null;
        after = null;
        authorClient = null;
      }
    }
  });
}
