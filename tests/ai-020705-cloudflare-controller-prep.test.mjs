// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import { generateKeyPairSync, sign, verify } from 'node:crypto';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import controllerDefault, {
  create020705ControllerCandidate
} from '../.github/staging-ai-02-07-05/cloudflare-gatea-controller-candidate.mjs';
// prettier-ignore
import {
  create020705ControllerArmIssuer
} from '../.github/staging-ai-02-07-05/gatea-controller-arm-issuer-candidate.mjs';

// prettier-ignore
const NOW = Date.parse('2026-11-18T07:00:00Z');
// prettier-ignore
const NONCE = 'N'.repeat(44);
// prettier-ignore
const KID = 'independent-gatea-01';
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_fixture123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 998892071,
  episodeId: 998892072,
  runId: 700,
  approvalCommentId: 601
});
// prettier-ignore
const request = (s = scope, path = '/_novelight/gatea/recover') =>
  new globalThis.Request('https://gatea-recovery.internal' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: s, envelope: {} })
  });

// prettier-ignore
test('deployed candidate default and disabled factory are both inert', async () => {
  assert.equal((await controllerDefault.fetch(request(), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  })).status, 404);
  let probes = 0;
  const handler = create020705ControllerCandidate({
    resolveTrustedRun: () => { probes += 1; return null; },
    readIndependentCapabilities: () => { probes += 1; return null; },
    makeStagingStopPorts: () => { probes += 1; return null; }
  });
  assert.equal((await handler.fetch(request(), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'false'
  })).status, 404);
  assert.equal((await handler.fetch(request(scope, '/status'), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  })).status, 404);
  assert.equal(probes, 0);
});

// prettier-ignore
test('no trusted source or independent capability means no privileged ports', async () => {
  let privileged = 0;
  const handler = create020705ControllerCandidate({
    resolveTrustedRun: async () => ({
      sourceVerified: false, ownerApproved: true, scope, controllerRunId: 701
    }),
    readIndependentCapabilities: async () => { privileged += 1; return {}; },
    makeStagingStopPorts: async () => { privileged += 1; return {}; }
  });
  assert.equal((await handler.fetch(request(), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  })).status, 404);
  assert.equal(privileged, 0);
  const noAuthority = create020705ControllerCandidate({
    resolveTrustedRun: async () => ({
      sourceVerified: true, ownerApproved: true, scope, controllerRunId: 701
    }),
    readIndependentCapabilities: async () => ({
      verifiedIndependentSource: false
    }),
    makeStagingStopPorts: async () => { privileged += 1; return {}; }
  });
  assert.equal((await noAuthority.fetch(request(), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  })).status, 404);
  assert.equal(privileged, 0);
});

// prettier-ignore
test('ARM issuer refuses missing independent real stop evidence before claim', async () => {
  let claims = 0;
  const issuer = create020705ControllerArmIssuer({
    inspectIndependentArm: async () => ({
      verifiedIndependentSource: true, watchdogArmVerified: true,
      separateFromRunner: true, controllerRunId: 701,
      runId: scope.runId, approvalCommentId: scope.approvalCommentId,
      killAuthorityVerified: false,
      stagingDisableVerified: true,
      sessionRevocationVerified: true,
      syntheticCleanupVerified: true,
      zeroCensusVerified: true,
      noPaidRetry: true,
      heartbeatAtMs: NOW - 1000
    }),
    claimArmOnce: async () => { claims += 1; return true; },
    signWithControllerKey: () => 'A'.repeat(86),
    now: () => NOW
  });
  await assert.rejects(issuer.issue({
    scope, nonce: NONCE, keyId: KID, controllerRunId: 701
  }), /CONTROLLER_ARM_NO_GO/u);
  assert.equal(claims, 0);
});

// prettier-ignore
test('ARM synthetic signature is exact, once-only, and cannot authorize paid call by itself', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  let claims = 0;
  const issuer = create020705ControllerArmIssuer({
    inspectIndependentArm: async () => ({
      verifiedIndependentSource: true,
      watchdogArmVerified: true,
      separateFromRunner: true,
      controllerRunId: 701,
      runId: scope.runId,
      approvalCommentId: scope.approvalCommentId,
      killAuthorityVerified: true,
      stagingDisableVerified: true,
      sessionRevocationVerified: true,
      syntheticCleanupVerified: true,
      zeroCensusVerified: true,
      noPaidRetry: true,
      heartbeatAtMs: NOW - 1000
    }),
    claimArmOnce: async () => { claims += 1; return claims === 1; },
    signWithControllerKey: (data) =>
      sign(null, Buffer.from(data), privateKey).toString('base64url'),
    now: () => NOW
  });
  const issued = await issuer.issue({
    scope, nonce: NONCE, keyId: KID, controllerRunId: 701
  });
  assert.equal(issued.receipt.kind, 'independent-controller-armed');
  assert.equal(issued.receipt.noPaidRetry, true);
  assert.equal(issued.receipt.expiresAtMs, NOW + 15000);
  assert.equal(issued.authorizesPaidCall, undefined);
  assert.equal(verify(null, Buffer.from(JSON.stringify([
    issued.domain, KID, NONCE, issued.receipt
  ])), publicKey, Buffer.from(issued.signature, 'base64url')), true);
  await assert.rejects(issuer.issue({
    scope, nonce: NONCE, keyId: KID, controllerRunId: 701
  }), /CONTROLLER_ARM_NO_GO/u);
  assert.equal(claims, 2);
});
