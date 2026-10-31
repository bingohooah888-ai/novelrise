// Phase 02-07-04: explicit, server-only trial assembly.
// The deployed analyze endpoint does NOT import this file. A separate,
// reviewed activation must supply a model, pricing, runtime policy and grant.
// Importing it cannot enable AI or send manuscript content to any provider.
import { createOwnerNovelBibleAuthorClientFactory } from './owner-novel-bible-author-client.js';
import { createOwnerNovelBibleConsentPermissionCheck } from './owner-novel-bible-consent.js';
import { createOwnerNovelBibleTrialRuntime } from './owner-novel-bible-trial-runtime.js';
import { resolveOwnerNovelBiblePreviewConfig } from './owner-novel-bible-preview.js';

const POLICY_REVISION = /^[a-z0-9][a-z0-9._-]{3,119}$/i;
const PROCESSORS = new Set(['openai', 'gemini']);

function unavailable() {
  throw new Error('AI_TRIAL_BINDING_UNAVAILABLE');
}

// Returns null while OFF. No defaults for providers, model, pricing or consent:
// each must be independently approved before any real runtime is assembled.
export function createOwnerNovelBibleTrialBridgeFactory({
  enabled = false,
  externalProcessingApproved = false,
  config,
  policyRevision,
  providers,
  routes,
  createClientImpl
} = {}) {
  if (!enabled || externalProcessingApproved !== true) return null;

  const verified = config
    ? resolveOwnerNovelBiblePreviewConfig({
        NOVELIGHT_AI_ADMIN_USER_ID: config.id,
        SUPABASE_URL: config.url,
        SUPABASE_PUBLISHABLE_KEY: config.key
      })
    : null;
  const selected = routes?.['novel-bible'];
  if (
    !verified ||
    typeof policyRevision !== 'string' ||
    !POLICY_REVISION.test(policyRevision) ||
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 2 ||
    !providers ||
    typeof providers !== 'object' ||
    selected.some(
      (route) =>
        !route ||
        !PROCESSORS.has(route.provider) ||
        typeof providers[route.provider]?.generate !== 'function' ||
        typeof route.model !== 'string' ||
        !/^[a-z0-9._-]{1,100}$/i.test(route.model) ||
        !Number.isSafeInteger(route.inputMicrosPerMillion) ||
        !Number.isSafeInteger(route.outputMicrosPerMillion) ||
        route.inputMicrosPerMillion <= 0 ||
        route.outputMicrosPerMillion <= 0 ||
        !Number.isSafeInteger(route.maxOutputTokens) ||
        route.maxOutputTokens < 1 ||
        route.maxOutputTokens > 4096
    )
  ) {
    unavailable();
  }

  const createAuthorClient = createOwnerNovelBibleAuthorClientFactory({
    config: verified,
    ...(createClientImpl ? { createClientImpl } : {})
  });

  // Compatible with the existing HTTP handler's createTrialBridge injection.
  // The production default export still passes null, not this factory.
  return async function createTrialBridge({ ownerId, serviceClient } = {}) {
    if (
      typeof ownerId !== 'string' ||
      ownerId.toLowerCase() !== verified.id ||
      typeof serviceClient?.auth?.getUser !== 'function' ||
      typeof serviceClient?.from !== 'function' ||
      typeof serviceClient?.rpc !== 'function'
    ) {
      unavailable();
    }

    const permissionCheck = createOwnerNovelBibleConsentPermissionCheck({
      enabled: true,
      ownerId: verified.id,
      serviceClient,
      routes,
      policyRevision
    });

    return createOwnerNovelBibleTrialRuntime({
      enabled: true,
      externalProcessingApproved: true,
      ownerId: verified.id,
      authClient: serviceClient,
      serviceClient,
      createAuthorClient,
      permissionCheck,
      providers,
      routes
    });
  };
}
