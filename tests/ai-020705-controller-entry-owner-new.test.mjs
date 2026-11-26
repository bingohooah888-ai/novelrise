// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import test from 'node:test';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
// prettier-ignore
import inert, { create020705ControllerExecutionEntryCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-execution-entry-candidate.mjs';
// prettier-ignore
import { create020705TrustedControllerBootstrapCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-trusted-bootstrap-candidate.mjs';

// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40), previewDeploymentId: 'dpl_fake123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 100, episodeId: 101, runId: 102, approvalCommentId: 103
});
// prettier-ignore
const args = Object.freeze({
  scope, nonce: 'N'.repeat(44), keyId: 'controller-key-fake01',
  controllerRunId: 104
});
// prettier-ignore
function fixture(overrides = {}) {
  const calls = { owner: 0, attest: 0, capability: 0, arm: 0, sign: 0 };
  const cfg = {
    async readOwnerApprovedScope() {
      calls.owner += 1;
      return {
        ...scope, scope: overrides.approvedScope ?? scope,
        sourceVerified: true, ownerApproved: true, controllerRunId: 104
      };
    },
    async verifyOwnerApprovalAttestation() {
      calls.attest += 1; return overrides.attested ?? false;
    },
    async readIndependentCapabilities() {
      calls.capability += 1;
      return {
        verifiedIndependentSource: true, separateFromRunner: true,
        stagingStopAuthorityVerified: true, syntheticRevocationVerified: true,
        independentCensusVerified: true
      };
    },
    async verifyCapabilityAttestation() { return overrides.capabilityAttested ?? false; },
    async makeStagingStopPorts() { throw new Error('MUST_NOT_TOUCH_STAGING'); },
    async verifyStagingPortAttestation() { return false; },
    async inspectIndependentArm() {
      calls.arm += 1; throw new Error('NO_ARM');
    },
    async signWithControllerKey() {
      calls.sign += 1; throw new Error('NO_SECRET');
    }
  };
  return { calls, cfg };
}

// prettier-ignore
test('default runtime stays 404 with flags set and no ports', async () => {
  const res = await inert.fetch(new globalThis.Request('https://example.com'), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true',
    GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED: 'true'
  });
  assert.equal(res.status, 404);
  assert.throws(() => create020705ControllerExecutionEntryCandidate(),
    /CONTROLLER_ENTRY_NO_GO/u);
});

// prettier-ignore
test('live entry opt-in flags are required before any authentication', async () => {
  const { calls, cfg } = fixture();
  const entry = create020705ControllerExecutionEntryCandidate(cfg);
  const response = await entry.fetch(new globalThis.Request('https://example.com'), {
    GATEA_CONTROLLER_LIVE_ENABLED: 'false',
    GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED: 'true'
  });
  assert.equal(response.status, 404);
  await assert.rejects(entry.issueArmReceipt(args, {}), /CONTROLLER_ENTRY_NO_GO/u);
  assert.deepEqual(calls, { owner: 0, attest: 0, capability: 0, arm: 0, sign: 0 });
});

// prettier-ignore
test('a signed ARM cannot be issued without authenticated OWNER attestation', async () => {
  const { calls, cfg } = fixture({ attested: false });
  const bootstrap = create020705TrustedControllerBootstrapCandidate(cfg);
  await assert.rejects(bootstrap.issueArmReceipt(args, {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  }), /CONTROLLER_BOOTSTRAP_NO_GO/u);
  assert.equal(calls.owner, 1);
  assert.equal(calls.attest, 1);
  assert.equal(calls.capability, 0);
  assert.equal(calls.arm, 0);
  assert.equal(calls.sign, 0);
});

// prettier-ignore
test('owner approval must bind complete actor, novel and episode scope', async () => {
  const { calls, cfg } = fixture({
    approvedScope: { ...scope, actorId: '22222222-2222-4222-8222-222222222222' },
    attested: true
  });
  const bootstrap = create020705TrustedControllerBootstrapCandidate(cfg);
  await assert.rejects(bootstrap.issueArmReceipt(args, {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  }), /CONTROLLER_BOOTSTRAP_NO_GO/u);
  assert.equal(calls.owner, 1);
  assert.equal(calls.attest, 0);
  assert.equal(calls.arm, 0);
});

// prettier-ignore
test('capability attestation is mandatory before signing or private claim', async () => {
  const { calls, cfg } = fixture({ attested: true, capabilityAttested: false });
  const bootstrap = create020705TrustedControllerBootstrapCandidate(cfg);
  await assert.rejects(bootstrap.issueArmReceipt(args, {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true'
  }), /CONTROLLER_BOOTSTRAP_NO_GO/u);
  assert.equal(calls.capability, 1);
  assert.equal(calls.arm, 0);
  assert.equal(calls.sign, 0);
});

// prettier-ignore
test('Controller consumes only a fresh signed full-scope receipt into the existing DO', async () => {
  const full = {...scope, candidateSha: 'b'.repeat(40),
    stagingBranch: 'staging/ai-02-07-05-offline', capMicros: 1000000};
  const {cfg} = fixture({approvedScope: full, attested: true});
  const keys = generateKeyPairSync('ed25519');
  const now = Date.now();
  const domain = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
  const receipt = {...full, kind: 'independent-controller-armed',
    protectedEnvironment: 'staging', controllerKind: 'external-independent-supervisor',
    controllerRunId: 104, controllerIsRunner: false, killAuthorityVerified: true,
    stagingDisableVerified: true, sessionRevocationVerified: true,
    syntheticCleanupVerified: true, zeroCensusVerified: true, noPaidRetry: true,
    observedAtMs: now, heartbeatAtMs: now, expiresAtMs: now + 15000};
  const envelope = {domain, keyId: args.keyId, challengeNonce: args.nonce, receipt,
    signature: sign(null, Buffer.from(JSON.stringify([
      domain, args.keyId, args.nonce, receipt
    ])), keys.privateKey).toString('base64url')};
  let claims = 0;
  const entry = create020705ControllerExecutionEntryCandidate({
    ...cfg, trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: args.keyId, expectedChallengeNonce: args.nonce,
    now: () => now
  });
  const env = {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true',
    GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED: 'true',
    GATEA_CLAIM_HMAC_KEY: randomBytes(32).toString('base64url'),
    GATEA_CLAIM_LEDGER: {
      idFromName(name) {assert.equal(name, 'ai-020705-102'); return name;},
      get() {return {async fetch(request) {
        claims++;
        const input = await request.json();
        assert.equal(input.kind, 'ARM_RECEIPT');
        assert.deepEqual(input.scope, scope);
        assert.equal(input.controllerRunId, 104);
        if (claims !== 1) return new globalThis.Response(null, {status: 404});
        return new globalThis.Response(JSON.stringify({
          claimed: true, kind: 'ARM_RECEIPT', runId: scope.runId,
          approvalCommentId: scope.approvalCommentId, controllerRunId: 104
        }), {status: 200, headers: {'content-type': 'application/json'}});
      }};}
    }
  };
  await assert.rejects(entry.consumeArmReceipt({scope: full, envelope}, {}),
    /CONTROLLER_ENTRY_NO_GO/u);
  await assert.rejects(entry.consumeArmReceipt({scope: full,
    envelope: {...envelope, signature: 'A'.repeat(86)}}, env),
    /CONTROLLER_ENTRY_NO_GO/u);
  await assert.rejects(entry.consumeArmReceipt({scope: {...full, capMicros: 42},
    envelope}, env), /CONTROLLER_ENTRY_NO_GO/u);
  assert.equal(claims, 0);
  assert.equal(await entry.consumeArmReceipt({scope: full, envelope}, env), true);
  await assert.rejects(entry.consumeArmReceipt({scope: full, envelope}, env),
    /CONTROLLER_ENTRY_NO_GO/u);
  assert.equal(claims, 2);
});
