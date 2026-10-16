// Preparation-only safety contract for future authenticated hosted browser tests.
// This module makes NO external requests and NEVER authorizes Staging writes.
const SHA = /^[a-f0-9]{40}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export const PRODUCTION_PROJECT_REF = 'fiepaguycecrredwrcwx';
export const EXISTING_SHARED_STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';

function deny(message) {
  throw new Error('COMMUNITY_HOSTED_WRITE_PREPARATION_DENIED: ' + message);
}

function exactOrigin(value, expectedSuffix) {
  let url;
  try {
    url = new URL(value);
  } catch {
    deny('invalid HTTPS origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith(expectedSuffix)
  ) {
    deny('only a protected exact HTTPS origin is permitted');
  }
  return url;
}

export const REQUIRED_HOSTED_PROOFS = Object.freeze([
  'OWNER one-use approval bound to fresh main, PR head and preview revision',
  'Explicit Preview/Staging billing authorization and protected deployment',
  'Disposable isolated Supabase project with audited schema and empty fixtures',
  'At least two separate test-user sessions and one dedicated test-admin session',
  'Anonymous denial, cross-user Block/Mute and owner opt-in/revoke',
  'Likes, comments, reports and notifications observed across test sessions',
  'Admin hide/restore and restrict/unrestrict with audit evidence',
  'R15/R18 and private/unpublished content excluded, including direct RPC',
  'Fail-closed disable, test user/data cleanup and migration-ledger postcheck'
]);

export function inspectCommunityHostedWritePreparation({
  mainSha,
  candidateSha,
  previewRevision,
  previewOrigin,
  supabaseOrigin,
  isolatedProjectRef,
  userIds
}) {
  if (![mainSha, candidateSha, previewRevision].every((sha) => SHA.test(sha))) {
    deny('invalid immutable commit identity');
  }
  if (mainSha === candidateSha || previewRevision !== candidateSha) {
    deny('Preview must be pinned to the exact unmerged feature candidate');
  }
  const preview = exactOrigin(previewOrigin, '.vercel.app');
  if (preview.hostname === 'novelrise.vercel.app') {
    deny('Production Vercel endpoint is forbidden');
  }
  if (!PROJECT_REF.test(isolatedProjectRef)) {
    deny('isolated project reference is malformed');
  }
  if (
    isolatedProjectRef === PRODUCTION_PROJECT_REF ||
    isolatedProjectRef === EXISTING_SHARED_STAGING_REF
  ) {
    deny('Production or shared Staging cannot host authenticated write fixtures');
  }
  const database = exactOrigin(supabaseOrigin, '.supabase.co');
  if (database.hostname !== isolatedProjectRef + '.supabase.co') {
    deny('isolated project reference does not match Staging origin');
  }
  if (
    !userIds ||
    !['author', 'reader', 'admin'].every((role) =>
      UUID.test(userIds[role] ?? '')
    ) ||
    new Set([userIds.author, userIds.reader, userIds.admin]).size !== 3
  ) {
    deny('three separate synthetic test identities are required');
  }
  // Structural input checks are not live ownership, authorization, security,
  // credential, data-isolation, test-run or cleanup proof.
  return Object.freeze({
    status: 'PREPARATION_ONLY',
    target: 'community-phase1-hosted-auth-write',
    isolatedProjectRef,
    candidateSha,
    writeAuthorized: false,
    runAuthorized: false,
    releaseAuthorized: false,
    missingEvidence: [...REQUIRED_HOSTED_PROOFS]
  });
}
