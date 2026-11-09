// Offline-only composition of EXISTING NOVELIGHT owner-only contracts.
// No public API imports this module; no DB, Auth or network implementation
// exists here. These injectable dependencies are SERVER CAPABILITIES, never
// fields copied from an HTTP request or other untrusted client input.
// Future production activation requires independent staging approval.
import { createOwnerOutlineInternalAdapter } from './owner-outline-internal-adapter.js';
import { createOfflineOwnerSessionCheck } from './owner-session-evidence.js';
import { createOfflinePrivateSessionReader } from './owner-private-session-reader.js';

export function createOfflineOwnerBibleNavigation({
  serviceClient,
  createAuthorClient,
  config,
  previewEnabled = false,
  verifySignedClaims,
  lookupOneSession,
  nowEpochSeconds
} = {}) {
  const readExistingSession = createOfflinePrivateSessionReader({
    lookupOneSession
  });
  const checkSession = createOfflineOwnerSessionCheck({
    verifySignedClaims,
    readExistingSession,
    nowEpochSeconds
  });
  const adapter = createOwnerOutlineInternalAdapter({
    serviceClient,
    createAuthorClient,
    config,
    previewEnabled,
    checkSession
  });

  // This is the existing owner-preview payload, NOT a browser-verifiable
  // assertion of ownership. The owner adapter rechecks user+novel for each
  // read; no manual "isOwner" flag, fallback or cached success is accepted.
  return Object.freeze({
    read: ({ bearer, expectedNovelId, preview } = {}) =>
      adapter.read({ bearer, expectedNovelId, preview })
  });
}
