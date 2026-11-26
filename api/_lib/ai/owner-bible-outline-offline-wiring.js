// Future SERVER-ONLY composition, deliberately below api/_lib (not a route).
// Reuses the established owner preview, outline navigation and session
// contracts. No Supabase client, privileged observer or transport is created
// here. Even with env flags set, enabled=false is the default.
import {
  createOwnerNovelBiblePreviewHandler,
  resolveOwnerNovelBiblePreviewConfig
} from './owner-novel-bible-preview.js';
import { createOfflineOwnerBibleOutlineApiHandler } from './owner-bible-outline-offline-api.js';

// Internal capture for an existing GET preview handler, not an HTTP response
// to the browser. Do not forward errors or private documents to logs.
function capturedPreviewResponse() {
  return {
    statusCode: 503,
    body: null,
    setHeader() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

export function createOfflineOwnerBibleOutlineWiring({
  enabled = false,
  env = process.env,
  serviceClient,
  createAuthorClient,
  lookupOneSession,
  nowEpochSeconds
} = {}) {
  // These are independently trusted SERVER capabilities, not fields that can
  // be provided through the request. No claim decoding or auth.sessions query
  // is implemented here; those must be supplied and proved before live use.
  const config = resolveOwnerNovelBiblePreviewConfig(env);
  const hasCapabilities =
    typeof serviceClient?.auth?.getUser === 'function' &&
    typeof serviceClient?.auth?.getClaims === 'function' &&
    typeof serviceClient?.from === 'function' &&
    typeof serviceClient?.rpc === 'function' &&
    typeof createAuthorClient === 'function' &&
    typeof lookupOneSession === 'function' &&
    typeof nowEpochSeconds === 'function';

  let handlePreview = null;
  if (enabled === true && config && hasCapabilities) {
    try {
      handlePreview = createOwnerNovelBiblePreviewHandler({
        serviceClient,
        createAuthorClient,
        env
      });
    } catch {
      // Remain unavailable; never fabricate preview/owner evidence.
    }
  }

  return createOfflineOwnerBibleOutlineApiHandler({
    env,
    enabled,
    config,
    serviceClient,
    createAuthorClient,
    lookupOneSession,
    nowEpochSeconds,
    verifySignedClaims:
      hasCapabilities && enabled === true
        ? (token) => serviceClient.auth.getClaims(token)
        : undefined,
    readOwnerPreview:
      handlePreview &&
      (async ({ bearer, novelId }) => {
        const reply = capturedPreviewResponse();
        // Outer HTTP handler already checked the external request method,
        // origin, bearer shape and work ID. The preview handler independently
        // rechecks the bearer owner and storage ownership.
        try {
          await handlePreview(
            {
              method: 'GET',
              headers: {
                authorization: bearer,
                origin: 'https://offline.internal',
                host: 'offline.internal',
                'sec-fetch-site': 'same-origin'
              },
              query: { novel_id: String(novelId) }
            },
            reply
          );
        } catch {
          return null;
        }
        return reply.statusCode === 200 ? reply.body : null;
      })
  });
}
