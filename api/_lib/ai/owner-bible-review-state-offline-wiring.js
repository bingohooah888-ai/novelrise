// Server-only offline composition for OWNER checklist durable persistence.
// NOT mounted under api/*.js, not imported by story-notes.html.
// Every required identity/session capability must be explicitly supplied.
// A real Supabase service client + privileged lookupOneSession must only be
// supplied after an independently scoped Staging/Production authorization.
import { createOfflineOwnerBibleReviewStateWorkflow } from './owner-bible-review-state-offline.js';
import { createSupabaseOwnerBibleReviewStateRepository } from './owner-bible-review-state-repository.js';
import { createOfflineOwnerSessionCheck } from './owner-session-evidence.js';
import { createOfflinePrivateSessionReader } from './owner-private-session-reader.js';

function unavailable() {
  throw new Error('AI_OWNER_REVIEW_STATE_UNAVAILABLE');
}

export function createOfflineOwnerBibleReviewStateWiring({
  enabled = false,
  ownerId,
  serviceClient,
  readOwnerPreview,
  lookupOneSession,
  nowEpochSeconds
} = {}) {
  if (
    typeof serviceClient?.auth?.getClaims !== 'function' ||
    typeof serviceClient?.auth?.getUser !== 'function' ||
    typeof serviceClient?.from !== 'function' ||
    typeof serviceClient?.rpc !== 'function' ||
    typeof readOwnerPreview !== 'function' ||
    typeof lookupOneSession !== 'function' ||
    typeof nowEpochSeconds !== 'function'
  ) {
    unavailable();
  }
  const repository = createSupabaseOwnerBibleReviewStateRepository({
    serviceClient,
    checkSession: createOfflineOwnerSessionCheck({
      verifySignedClaims: (token) => serviceClient.auth.getClaims(token),
      readExistingSession: createOfflinePrivateSessionReader({
        lookupOneSession
      }),
      nowEpochSeconds
    })
  });

  return createOfflineOwnerBibleReviewStateWorkflow({
    enabled,
    ownerId,
    authClient: serviceClient,
    serviceClient,
    readOwnerPreview,
    repository
  });
}
