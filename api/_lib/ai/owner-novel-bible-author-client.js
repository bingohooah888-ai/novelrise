// Phase 02-07-04: author-scoped RPC client factory for a future trial.
// This module is not imported by public APIs. It does not grant consent,
// activate an AI model, change budgets or perform any database writes.
import { createClient } from '@supabase/supabase-js';

import { resolveOwnerNovelBiblePreviewConfig } from './owner-novel-bible-preview.js';

function unavailable() {
  throw new Error('AI_TRIAL_AUTHOR_CLIENT_UNAVAILABLE');
}

function denied() {
  throw new Error('AI_TRIAL_AUTHOR_CLIENT_DENIED');
}

// Require the same strict public-key and owner configuration used by the
// dormant preview. The service-role/secret key must NEVER be used for author
// RPC calls, which independently authorize using auth.uid().
export function createOwnerNovelBibleAuthorClientFactory({
  config,
  createClientImpl = createClient
} = {}) {
  if (typeof createClientImpl !== 'function' || !config) unavailable();
  const verified = resolveOwnerNovelBiblePreviewConfig({
    SUPABASE_URL: config.url,
    SUPABASE_PUBLISHABLE_KEY: config.key,
    NOVELIGHT_AI_ADMIN_USER_ID: config.id
  });
  if (!verified) unavailable();

  return async function createAuthorClient({ token, actorId } = {}) {
    if (
      typeof actorId !== 'string' ||
      actorId.toLowerCase() !== verified.id ||
      typeof token !== 'string' ||
      token.length < 16 ||
      token.length > 4096 ||
      /\s/u.test(token)
    ) {
      denied();
    }

    let authorClient;
    try {
      // Per-request client, using a publishable key and only the current
      // owner's verified bearer, never a server-side privileged key.
      authorClient = createClientImpl(verified.url, verified.key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        },
        global: { headers: { Authorization: 'Bearer ' + token } }
      });
      if (
        typeof authorClient?.auth?.getUser !== 'function' ||
        typeof authorClient?.rpc !== 'function'
      ) {
        unavailable();
      }
      // Independently verify the token with the project Auth service.
      // Runtime and bridge perform their own fresh checks too.
      const identity = await authorClient.auth.getUser(token);
      if (
        identity?.error ||
        typeof identity?.data?.user?.id !== 'string' ||
        identity.data.user.id.toLowerCase() !== verified.id
      ) {
        denied();
      }
    } catch {
      // Never leak a client-library error that could include the JWT,
      // publishable key, endpoint headers or other private context.
      denied();
    }
    return authorClient;
  };
}
