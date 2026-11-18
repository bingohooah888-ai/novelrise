// New OFFLINE-only signed observer tests: no Cloudflare or Staging I/O.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { create020705IndependentObserverPortsCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-independent-observers-candidate.mjs';

// prettier-ignore
const NOW = Date.parse('2026-11-18T07:00:00Z');
// prettier-ignore
const VERSION = '9948be49-1111-4111-8111-111111111111';
// prettier-ignore
const ARTIFACT = 'c'.repeat(64);
// prettier-ignore
const identity = {controllerRunId: 2002, runId: 1001, approvalCommentId: 700,
  mainSha: 'a'.repeat(40), previewDeploymentId: 'dpl_fixture123'};
// prettier-ignore
const scope = {repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: identity.mainSha, previewDeploymentId: identity.previewDeploymentId,
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 41, episodeId: 11, runId: 1001, approvalCommentId: 700};
// prettier-ignore
const target = {projectRef: scope.stagingProjectRef,
  userId: scope.actorId, novelId: scope.novelId,
  approvalCommentId: scope.approvalCommentId};
// prettier-ignore
const counts = ['users','identities','sessions','profiles','novels','episodes',
  'facts','analysis','reviewCandidates','consents','consentAudit',
  'usageRequests','usageAudit'];
// prettier-ignore
function setup({tamper = false, censusTamper = false, stale = false,
  observedVersion = VERSION, pinnedVersion = VERSION,
  observedArtifact = ARTIFACT, pinnedArtifact = ARTIFACT} = {}) {
  const idKeys = generateKeyPairSync('ed25519');
  const censusKeys = generateKeyPairSync('ed25519');
  const idKeyId = 'offrunner-identity-key';
  const censusKeyId = 'independent-census-key';
  const identityEvidence = {kind: 'INDEPENDENT_CONTROLLER_IDENTITY',
    accountId: '6831b18fe814232fa2dd4c470b95aa15',
    workerName: 'novelight-ai-gatea-watchdog',
    namespaceId: '015ef5be967f4fbfbad31ab24a22bf26',
    projectRef: scope.stagingProjectRef, controllerRunId: 2002,
    separateFromRunner: true, pinnedIdentityVerified: true};
  const caps = {kind: 'INDEPENDENT_CONTROLLER_CAPABILITIES',
    ...identityEvidence, kind: 'INDEPENDENT_CONTROLLER_CAPABILITIES',
    runId: 1001, verifiedIndependentSource: true,
    signedDeathProofAvailable: true, atomicRecoveryClaimAvailable: true,
    stagingStopAuthorityVerified: true, syntheticRevocationVerified: true,
    independentCensusVerified: true,
    quotaIndependentStopVerified: true,
    providerDispatchFenceVerified: true,
    jwtAccessDenyVerified: true,
    sqliteRollbackPreservedVerified: true,
    watchdogFullVersionId: observedVersion,
    watchdogArtifactSha256: observedArtifact,
    watchdogSourceParityVerified: true,
    inFlightProviderRequests: 0,
    providerCancellationMode: 'NOT_GUARANTEED'};
  const census = {sourceKind: 'SEPARATE_STAGING_READONLY_CENSUS',
    ...target, runtimeDisabledZero: true, approvalTombstoneCount: 1,
    chunkClaimsRetained: 1,
    ...Object.fromEntries(counts.map((name) => [name, 0]))};
  function service(kind) {
    return {async fetch(request) {
      const body = await request.json();
      const data = kind === 'identity'
        ? (body.domain.includes('CAPABILITIES') ? caps : identityEvidence)
        : census;
      const keyId = kind === 'identity' ? idKeyId : censusKeyId;
      const key = kind === 'identity' ? idKeys.privateKey : censusKeys.privateKey;
      const observedAtMs = stale ? NOW - 20000 : NOW;
      const expiresAtMs = observedAtMs + 10000;
      const packet = [body.domain, keyId, body.nonce, body.scope,
        data, observedAtMs, expiresAtMs];
      let signature = sign(null, Buffer.from(JSON.stringify(packet)), key)
        .toString('base64url');
      if (tamper && kind === 'identity') signature =
        (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
      const evidence = censusTamper && kind === 'census'
        ? {...data, sessions: 1} : data;
      return new globalThis.Response(JSON.stringify({
        domain: body.domain, keyId, nonce: body.nonce, scope: body.scope,
        evidence, observedAtMs, expiresAtMs, signature
      }), {status: 200, headers: {'content-type': 'application/json'}});
    }};
  }
  const ports = create020705IndependentObserverPortsCandidate({
    identityService: service('identity'),
    censusService: service('census'),
    identityPublicKey: idKeys.publicKey.export({type:'spki',format:'der'})
      .toString('base64'),
    censusPublicKey: censusKeys.publicKey.export({type:'spki',format:'der'})
      .toString('base64'),
    identityKeyId: idKeyId, censusKeyId,
    expectedWatchdogVersionId: pinnedVersion,
    expectedWatchdogArtifactSha256: pinnedArtifact,
    cryptoImpl: webcrypto, now: () => NOW
  });
  return ports;
}
// prettier-ignore
test('separate pinned Ed25519 observers prove identity and signed scoped counts', async () => {
  const ports = setup();
  assert.equal(await ports.verifyIndependentControllerIdentity(identity), true);
  const trusted = {scope, controllerRunId: 2002};
  const capability = await ports.readIndependentCapabilities(trusted);
  assert.equal(await ports.verifyCapabilityAttestation(capability, trusted), true);
  assert.equal(await ports.verifyCapabilityAttestation({...capability}, trusted), false);
  assert.equal((await ports.independentCensus(target)).sessions, 0);
});
// prettier-ignore
test('invalid signature, stale proof and altered census fail closed', async () => {
  assert.equal(await setup({tamper:true})
    .verifyIndependentControllerIdentity(identity), false);
  assert.equal(await setup({stale:true})
    .verifyIndependentControllerIdentity(identity), false);
  await assert.rejects(setup({censusTamper:true}).independentCensus(target),
    /INDEPENDENT_OBSERVER_NO_GO/u);
});
// prettier-ignore
test('no observer, shared identity service, or mismatched scopes deny', async () => {
  assert.throws(() => create020705IndependentObserverPortsCandidate(),
    /INDEPENDENT_OBSERVER_NO_GO/u);
  assert.equal(await setup().verifyIndependentControllerIdentity(
    {...identity, mainSha: 'wrong'}), false);
  await assert.rejects(setup().independentCensus({...target, novelId: -1}),
    /INDEPENDENT_OBSERVER_NO_GO/u);
});

// prettier-ignore
test('full Cloudflare version and source artifact must match independent pins', async () => {
  for (const change of [
    {observedVersion: '9948be49-1111-4111-8111-111111111112'},
    {observedVersion: '9948be49'},
    {observedArtifact: 'd'.repeat(64)}
  ]) {
    await assert.rejects(
      setup(change).readIndependentCapabilities({scope, controllerRunId: 2002}),
      /INDEPENDENT_OBSERVER_NO_GO/u
    );
  }
  assert.throws(() => setup({pinnedVersion: '9948be49'}),
    /INDEPENDENT_OBSERVER_NO_GO/u);
  assert.throws(() => setup({pinnedVersion:
    '22222222-1111-4111-8111-111111111111'}),
  /INDEPENDENT_OBSERVER_NO_GO/u);
  assert.throws(() => setup({pinnedArtifact: 'unverified'}),
    /INDEPENDENT_OBSERVER_NO_GO/u);
});
