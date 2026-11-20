// CODE ONLY. Independent attestors MUST own different identities/keys and
// use private Service Bindings. Importing this module does not perform I/O.
// A signed observation is NOT proof of a successful live STOP or DB census.
const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const ACCOUNT = '6831b18fe814232fa2dd4c470b95aa15';
const WORKER = 'novelight-ai-gatea-watchdog';
const NAMESPACE = '015ef5be967f4fbfbad31ab24a22bf26';
const ID_DOMAIN = 'NOVELIGHT_AI_020705_CONTROLLER_IDENTITY_V1';
const CAP_DOMAIN = 'NOVELIGHT_AI_020705_CONTROLLER_CAPABILITIES_V1';
const CENSUS_DOMAIN = 'NOVELIGHT_AI_020705_INDEPENDENT_CENSUS_V1';
const NAMES = ['repository', 'stagingProjectRef', 'mainSha',
  'previewDeploymentId', 'actorId', 'novelId', 'episodeId', 'runId',
  'approvalCommentId'];
const COUNTS = ['users', 'identities', 'sessions', 'profiles',
  'novels', 'episodes', 'facts', 'analysis', 'reviewCandidates',
  'consents', 'consentAudit', 'usageRequests', 'usageAudit'];
const NONCE = /^[A-Za-z0-9_-]{43}$/u;
const KID = /^[A-Za-z0-9_-]{8,64}$/u;
const SIG = /^[A-Za-z0-9_-]{86}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
// Cloudflare Workers versions are UUIDs; an eight-character display prefix
// or an unsigned self-assertion cannot pin the actual deployed version.
const VERSION = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const ARTIFACT_SHA256 = /^[a-f0-9]{64}$/u;
const CURRENT_WATCHDOG_PREFIX = '9948be49';
const positive = (v) => Number.isSafeInteger(v) && v > 0;
function deny() { throw new Error('AI_020705_INDEPENDENT_OBSERVER_NO_GO'); }
function exact(a, b) {
  return a && b && !Array.isArray(a) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}
function validRun(s) {
  const extensions = ['candidateSha', 'stagingBranch', 'capMicros'];
  const extended = extensions.some((key) => Object.hasOwn(s ?? {}, key));
  return s?.repository === REPO && s?.stagingProjectRef === STAGING &&
    Object.keys(s).length === NAMES.length + (extended ? 3 : 0) &&
    NAMES.every((key) => Object.hasOwn(s, key)) &&
    Object.keys(s).every((key) => NAMES.includes(key) ||
      extensions.includes(key)) &&
    SHA.test(s.mainSha ?? '') &&
    /^dpl_[A-Za-z0-9]+$/u.test(s.previewDeploymentId ?? '') &&
    UUID.test(s.actorId ?? '') &&
    ['novelId', 'episodeId', 'runId', 'approvalCommentId']
      .every((key) => positive(s[key])) &&
    (!extended || (SHA.test(s.candidateSha ?? '') &&
      s.candidateSha !== s.mainSha &&
      /^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(s.stagingBranch ?? '') &&
      positive(s.capMicros) && s.capMicros <= 10000000));
}
function base64(data) {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
function decode(data) {
  if (typeof data !== 'string' || data.length > 512 ||
      !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(data)) deny();
  return Uint8Array.from(atob(data.replace(/-/gu, '+')
    .replace(/_/gu, '/') + '='.repeat((4 - data.length % 4) % 4)),
  (ch) => ch.charCodeAt(0));
}
function nonce(cryptoImpl) {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return base64(bytes);
}
async function verifySignature(publicKey, signature, body, cryptoImpl) {
  if (!SIG.test(signature ?? '')) return false;
  try {
    const key = await cryptoImpl.subtle.importKey('spki',
      decode(publicKey), {name: 'Ed25519'}, false, ['verify']);
    return await cryptoImpl.subtle.verify({name: 'Ed25519'}, key,
      decode(signature), new TextEncoder().encode(JSON.stringify(body)));
  } catch { return false; }
}

/** A cryptographically checked private observer response, never a caller flag. */
export function create020705IndependentObserverPortsCandidate({
  identityService, censusService, identityPublicKey, censusPublicKey,
  identityKeyId, censusKeyId,
  expectedWatchdogVersionId, expectedWatchdogArtifactSha256,
  cryptoImpl = globalThis.crypto, now = Date.now
} = {}) {
  if (!identityService || !censusService ||
      identityService === censusService ||
      typeof identityService.fetch !== 'function' ||
      typeof censusService.fetch !== 'function' ||
      !KID.test(identityKeyId ?? '') || !KID.test(censusKeyId ?? '') ||
      identityKeyId === censusKeyId ||
      identityPublicKey === censusPublicKey ||
      typeof identityPublicKey !== 'string' ||
      typeof censusPublicKey !== 'string' ||
      !VERSION.test(expectedWatchdogVersionId ?? '') ||
      !expectedWatchdogVersionId.startsWith(CURRENT_WATCHDOG_PREFIX) ||
      !ARTIFACT_SHA256.test(expectedWatchdogArtifactSha256 ?? '') ||
      !cryptoImpl?.subtle ||
      typeof cryptoImpl.getRandomValues !== 'function' ||
      typeof now !== 'function') deny();
  const attested = new WeakMap();
  async function observe(service, domain, keyId, publicKey, scope) {
    const challenge = nonce(cryptoImpl);
    const path = domain === CENSUS_DOMAIN ? '/_novelight/gatea/census'
      : '/_novelight/gatea/attest';
    try {
      const response = await service.fetch(new Request(
        'https://gatea-observer.internal' + path, {
          method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({domain, nonce: challenge, scope})
        }));
      if (response?.status !== 200 ||
          response.headers?.get('content-type') !== 'application/json') deny();
      const raw = await response.text();
      if (!raw || raw.length > 4096) deny();
      const result = JSON.parse(raw);
      if (!result || Object.keys(result).sort().join(',') !==
          'domain,evidence,expiresAtMs,keyId,nonce,observedAtMs,scope,signature' ||
          result.domain !== domain || result.keyId !== keyId ||
          result.nonce !== challenge || !exact(result.scope, scope) ||
          !result.evidence || typeof result.evidence !== 'object' ||
          Array.isArray(result.evidence) ||
          !Number.isSafeInteger(result.observedAtMs) ||
          !Number.isSafeInteger(result.expiresAtMs)) deny();
      const at = now();
      if (!Number.isSafeInteger(at) ||
          result.observedAtMs > at + 2000 ||
          at - result.observedAtMs > 10000 ||
          result.expiresAtMs <= at ||
          result.expiresAtMs - result.observedAtMs > 15000 ||
          !(await verifySignature(publicKey, result.signature, [
            domain, keyId, challenge, result.scope, result.evidence,
            result.observedAtMs, result.expiresAtMs
          ], cryptoImpl))) deny();
      return result.evidence;
    } catch { deny(); }
  }
  async function verifyIndependentControllerIdentity(identity) {
    if (!identity || !positive(identity.controllerRunId) ||
        !positive(identity.runId) ||
        identity.controllerRunId === identity.runId ||
        !positive(identity.approvalCommentId) ||
        !SHA.test(identity.mainSha ?? '') ||
        !/^dpl_[A-Za-z0-9]+$/u.test(identity.previewDeploymentId ?? ''))
      return false;
    try {
      const evidence = await observe(identityService, ID_DOMAIN,
        identityKeyId, identityPublicKey, identity);
      return evidence.kind === 'INDEPENDENT_CONTROLLER_IDENTITY' &&
        evidence.accountId === ACCOUNT &&
        evidence.workerName === WORKER &&
        evidence.namespaceId === NAMESPACE &&
        evidence.projectRef === STAGING &&
        evidence.controllerRunId === identity.controllerRunId &&
        evidence.separateFromRunner === true &&
        evidence.pinnedIdentityVerified === true;
    } catch { return false; }
  }
  async function readIndependentCapabilities(trusted) {
    if (!validRun(trusted?.scope) ||
        !positive(trusted?.controllerRunId) ||
        trusted.controllerRunId === trusted.scope.runId) deny();
    const scope = { ...trusted.scope };
    const evidence = await observe(identityService, CAP_DOMAIN,
      identityKeyId, identityPublicKey, {
        ...scope, controllerRunId: trusted.controllerRunId
      });
    if (evidence.kind !== 'INDEPENDENT_CONTROLLER_CAPABILITIES' ||
        evidence.accountId !== ACCOUNT || evidence.workerName !== WORKER ||
        evidence.namespaceId !== NAMESPACE ||
        evidence.projectRef !== STAGING ||
        evidence.runId !== scope.runId ||
        evidence.controllerRunId !== trusted.controllerRunId ||
        evidence.verifiedIndependentSource !== true ||
        evidence.separateFromRunner !== true ||
        evidence.signedDeathProofAvailable !== true ||
        evidence.atomicRecoveryClaimAvailable !== true ||
        evidence.stagingStopAuthorityVerified !== true ||
        evidence.syntheticRevocationVerified !== true ||
        evidence.independentCensusVerified !== true ||
        evidence.quotaIndependentStopVerified !== true ||
        evidence.providerDispatchFenceVerified !== true ||
        evidence.jwtAccessDenyVerified !== true ||
        evidence.sqliteRollbackPreservedVerified !== true ||
        evidence.watchdogFullVersionId !== expectedWatchdogVersionId ||
        evidence.watchdogArtifactSha256 !==
          expectedWatchdogArtifactSha256 ||
        evidence.watchdogSourceParityVerified !== true ||
        evidence.inFlightProviderRequests !== 0 ||
        evidence.providerCancellationMode !== 'NOT_GUARANTEED') deny();
    const proof = Object.freeze({...evidence});
    attested.set(proof, trusted);
    return proof;
  }
  async function independentCensus(target) {
    if (target?.projectRef !== STAGING ||
        !UUID.test(target?.userId ?? '') ||
        !positive(target?.novelId) ||
        !positive(target?.approvalCommentId) ||
        Object.keys(target).sort().join(',') !==
          'approvalCommentId,novelId,projectRef,userId') deny();
    const evidence = await observe(censusService, CENSUS_DOMAIN,
      censusKeyId, censusPublicKey, target);
    if (evidence.sourceKind !== 'SEPARATE_STAGING_READONLY_CENSUS' ||
        evidence.projectRef !== STAGING ||
        evidence.userId !== target.userId ||
        evidence.novelId !== target.novelId ||
        evidence.approvalCommentId !== target.approvalCommentId ||
        evidence.runtimeDisabledZero !== true ||
        evidence.approvalTombstoneCount !== 1 ||
        !Number.isSafeInteger(evidence.chunkClaimsRetained) ||
        evidence.chunkClaimsRetained < 0 ||
        evidence.chunkClaimsRetained > 1 ||
        COUNTS.some((key) => evidence[key] !== 0)) deny();
    // A signature alone does not establish that the remote observer queried
    // the DB. Require separately audited live readback and auth.sessions.
    return Object.freeze({...evidence});
  }
  return Object.freeze({
    verifyIndependentControllerIdentity,
    readIndependentCapabilities,
    verifyCapabilityAttestation: async (proof, trusted) =>
      !!proof && attested.get(proof) === trusted,
    independentCensus
  });
}
