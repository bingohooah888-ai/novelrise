// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import { generateKeyPairSync, sign } from 'node:crypto';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import { dispatch020705DeathToRecoveryController } from '../.github/staging-ai-02-07-05/cloudflare-gatea-live-candidate.mjs';
// prettier-ignore
import { create020705ExistingWatchdogEntrypoint } from '../.github/staging-ai-02-07-05/existing-watchdog-entrypoint.mjs';

// prettier-ignore
const NOW = Date.parse('2026-11-14T11:30:00Z');
// prettier-ignore
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
// prettier-ignore
const ACTOR = '11111111-1111-4111-8111-111111111111';
// prettier-ignore
const KID = 'gatea-independent-key';
// prettier-ignore
const NONCE = 'N'.repeat(44);
// prettier-ignore
const keys = generateKeyPairSync('ed25519');
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: STAGING,
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_test123',
  actorId: ACTOR,
  novelId: 998892071,
  episodeId: 998892072,
  runId: 700,
  approvalCommentId: 601
});
// prettier-ignore
const COUNTS = [
  'users', 'identities', 'sessions', 'profiles', 'novels', 'episodes',
  'facts', 'analysis', 'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit'
];
// prettier-ignore
function signedReceipt() {
  const proof = {
    ...scope,
    kind: 'detached-controller-runner-death',
    runnerConfirmedDead: true,
    controllerIsRunner: false,
    controllerRunId: 701,
    observedAtMs: NOW,
    runnerHeartbeatAtMs: NOW - 1000,
    expiresAtMs: NOW + 10000
  };
  return {
    domain: 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1',
    keyId: KID, challengeNonce: NONCE,
    proof,
    signature: sign(
      null,
      Buffer.from(JSON.stringify([
        'NOVELIGHT_AI_020705_DETACHED_DEATH_V1', KID, NONCE, proof
      ])),
      keys.privateKey
    ).toString('base64url')
  };
}
// Offline stand-ins for a separately deployed controller; these mocks are
// NOT evidence that real Cloudflare/Vercel/Supabase authorities exist.
// prettier-ignore
function fixture({ forged = false, killFails = false, zeroFails = false } = {}) {
  const calls = [];
  const receipt = signedReceipt();
  if (forged) receipt.signature = 'A'.repeat(86);
  const allowed = {
    verifiedIndependentSource: true,
    accountId: '6831b18fe814232fa2dd4c470b95aa15',
    workerName: 'novelight-ai-gatea-watchdog',
    namespaceId: '015ef5be967f4fbfbad31ab24a22bf26',
    projectRef: STAGING,
    runId: scope.runId,
    controllerRunId: 701,
    separateFromRunner: true,
    signedDeathProofAvailable: true,
    atomicRecoveryClaimAvailable: true,
    stagingStopAuthorityVerified: true,
    syntheticRevocationVerified: true,
    independentCensusVerified: true
  };
  const completed = {
    projectRef: STAGING,
    userId: ACTOR,
    novelId: scope.novelId,
    approvalCommentId: scope.approvalCommentId,
    runtimeDisabledZero: true,
    approvalTombstoneCount: 1,
    chunkClaimsRetained: 1,
    ...Object.fromEntries(COUNTS.map((key) => [key, 0]))
  };
  const query = (step) => ({
    eq() { return this; },
    then(resolve) {
      calls.push(step);
      resolve({ error: null });
    }
  });
  const serviceClient = {
    supabaseUrl: 'https://' + STAGING + '.supabase.co',
    from(table) {
      return {
        update() { return query('stage-disabled'); },
        delete() { return query('delete-' + table); },
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: { id: scope.novelId, user_id: ACTOR },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const authAdmin = {
    async getUserById() {
      return { data: { user: {
        id: ACTOR,
        email: 'novelight-ai-020705-fixture@example.invalid',
        app_metadata: { internal_e2e: true }
      } } };
    },
    async deleteUser() {
      calls.push('delete-synthetic-auth');
      return { error: null };
    }
  };
  let claims = 0;
  const entry = create020705ExistingWatchdogEntrypoint({
    scope,
    controllerRunId: 701,
    readControllerCapabilities: async () => {
      calls.push('independent-capability-read');
      return allowed;
    },
    stopOptions: {
      synthetic: {
        verifiedSynthetic: true,
        projectRef: STAGING,
        supabaseUrl: 'https://' + STAGING + '.supabase.co',
        userId: ACTOR,
        novelId: scope.novelId,
        approvalCommentId: scope.approvalCommentId
      },
      serviceClient, authAdmin,
      trustedControllerPublicKey: keys.publicKey,
      trustedControllerKeyId: KID,
      expectedChallengeNonce: NONCE,
      now: () => NOW,
      claimRecoveryOnce: async () => {
        calls.push('atomic-recovery-claim');
        claims += 1;
        return claims === 1;
      },
      stopModelTransport: async () => {
        calls.push('kill-provider-transport');
        return !killFails;
      },
      disableTrialEnvironment: async () => {
        calls.push('disable-isolated-preview');
        return true;
      },
      revokeSyntheticSessions: async () => {
        calls.push('revoke-synthetic-jwt');
        return true;
      },
      independentCensus: async () => {
        calls.push('independent-census');
        return {
          ...completed,
          ...(zeroFails ? { sessions: 1 } : {})
        };
      }
    }
  });
  return { calls, entry, receipt };
}

// prettier-ignore
test('offline signed Cloudflare DO notification reaches existing stop/revoke/cleanup/census exactly once', async () => {
  const { entry, receipt, calls } = fixture();
  const service = { fetch: (request) => entry.handleRecoveryRequest(request) };
  const proof = await dispatch020705DeathToRecoveryController({
    service, scope, envelope: receipt
  });
  assert.equal(proof.dispatchedToSeparateController, true);
  assert.equal(proof.cleanupVerifiedByCloudflare, false);
  assert.ok(calls.indexOf('kill-provider-transport') <
    calls.indexOf('stage-disabled'));
  assert.ok(calls.indexOf('stage-disabled') <
    calls.indexOf('revoke-synthetic-jwt'));
  assert.ok(calls.indexOf('revoke-synthetic-jwt') <
    calls.indexOf('delete-synthetic-auth'));
  assert.ok(calls.indexOf('delete-synthetic-auth') <
    calls.indexOf('independent-census'));
  const previousLength = calls.length;
  await assert.rejects(
    dispatch020705DeathToRecoveryController({
      service, scope, envelope: receipt
    }),
    /CLOUDFLARE_LIVE_NO_GO/u
  );
  assert.equal(calls.length, previousLength);
});

// prettier-ignore
test('missing independent binding, forged signature and wrong scope never perform recovery', async () => {
  const { entry, receipt, calls } = fixture({ forged: true });
  assert.equal((await entry.handleRecoveryRequest(new globalThis.Request(
    'https://gatea-recovery.internal/_novelight/gatea/recover',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, envelope: receipt }) }
  ))).status, 404);
  assert.ok(!calls.includes('kill-provider-transport'));
  await assert.rejects(
    dispatch020705DeathToRecoveryController({
      scope, envelope: receipt
    }), /CLOUDFLARE_LIVE_NO_GO/u
  );
  const safe = fixture();
  const altered = { ...scope, runId: 702 };
  assert.equal((await safe.entry.handleRecoveryRequest(new globalThis.Request(
    'https://gatea-recovery.internal/_novelight/gatea/recover',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: altered, envelope: safe.receipt }) }
  ))).status, 404);
  assert.deepEqual(safe.calls, []);
});

// prettier-ignore
test('independent transport STOP or zero-census failure cannot return success', async () => {
  for (const flags of [{ killFails: true }, { zeroFails: true }]) {
    const { entry, receipt, calls } = fixture(flags);
    const service = { fetch: (request) => entry.handleRecoveryRequest(request) };
    await assert.rejects(
      dispatch020705DeathToRecoveryController({
        service, scope, envelope: receipt
      }), /CLOUDFLARE_LIVE_NO_GO/u
    );
    assert.ok(calls.includes('atomic-recovery-claim'));
    assert.ok(calls.includes('kill-provider-transport'));
    assert.ok(calls.includes('independent-census'));
  }
});
