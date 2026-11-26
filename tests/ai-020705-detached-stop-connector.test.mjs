import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { create020705DetachedStopConnector } from '../.github/staging-ai-02-07-05/detached-stop-connector.mjs';

const NOW = Date.parse('2026-11-14T05:00:00Z');
const URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const ID = '11111111-1111-4111-8111-111111111111';
const keys = generateKeyPairSync('ed25519');
const NONCE = 'B'.repeat(44);
const KID = 'external-controller-02';
const COUNTS = [
  'users',
  'identities',
  'sessions',
  'profiles',
  'novels',
  'episodes',
  'facts',
  'analysis',
  'reviewCandidates',
  'consents',
  'consentAudit',
  'usageRequests',
  'usageAudit'
];

function build({ badKey = false, killFailed = false } = {}) {
  const calls = [];
  const scope = {
    repository: 'bingohooah888-ai/novelrise',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
    mainSha: 'a'.repeat(40),
    previewDeploymentId: 'dpl_test123',
    actorId: ID,
    novelId: 41,
    episodeId: 11,
    runId: 1001,
    approvalCommentId: 777
  };
  const synthetic = {
    verifiedSynthetic: true,
    projectRef: scope.stagingProjectRef,
    supabaseUrl: URL,
    userId: ID,
    novelId: 41,
    approvalCommentId: 777
  };
  const serviceClient = {
    supabaseUrl: URL,
    from(table) {
      return {
        update() {
          calls.push('stop');
          return {
            eq() {
              return this;
            },
            then(resolve) {
              resolve({ error: null });
            }
          };
        },
        delete() {
          calls.push('delete:' + table);
          return {
            eq() {
              return this;
            },
            then(resolve) {
              resolve({ error: null });
            }
          };
        },
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { id: 41, user_id: ID },
                  error: null
                })
              };
            }
          };
        }
      };
    }
  };
  const trial = create020705DetachedStopConnector({
    scope,
    synthetic,
    serviceClient,
    authAdmin: {
      getUserById: async () => ({
        data: {
          user: {
            id: ID,
            email: 'novelight-ai-020705-fixture@example.invalid',
            app_metadata: { internal_e2e: true }
          }
        },
        error: null
      }),
      deleteUser: async () => {
        calls.push('delete-user');
        return { error: null };
      }
    },
    controllerRunId: 2002,
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: KID,
    expectedChallengeNonce: NONCE,
    async readIndependentDeathProof() {
      calls.push('independent-death');
      const proof = {
        ...scope,
        kind: 'detached-controller-runner-death',
        runnerConfirmedDead: true,
        controllerIsRunner: false,
        controllerRunId: 2002,
        observedAtMs: NOW,
        runnerHeartbeatAtMs: NOW - 1000,
        expiresAtMs: NOW + 10000
      };
      return {
        domain: 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1',
        keyId: KID,
        challengeNonce: NONCE,
        proof,
        signature: sign(
          null,
          Buffer.from(
            JSON.stringify([
              'NOVELIGHT_AI_020705_DETACHED_DEATH_V1',
              KID,
              NONCE,
              proof
            ])
          ),
          (badKey ? generateKeyPairSync('ed25519') : keys).privateKey
        ).toString('base64url')
      };
    },
    claimRecoveryOnce: async () => {
      calls.push('claim');
      return true;
    },
    stopModelTransport: async () => {
      calls.push('kill-provider-transport');
      return !killFailed;
    },
    disableTrialEnvironment: async () => {
      calls.push('disable-preview');
      return true;
    },
    revokeSyntheticSessions: async () => {
      calls.push('revoke');
      return true;
    },
    independentCensus: async () => {
      calls.push('census');
      return {
        projectRef: scope.stagingProjectRef,
        runtimeDisabledZero: true,
        approvalTombstoneCount: 1,
        ...Object.fromEntries(COUNTS.map((name) => [name, 0]))
      };
    },
    now: () => NOW
  });
  return { trial, calls };
}

test('detached process reuses stop, session revoke, cleanup and independent census', async () => {
  const { trial, calls } = build();
  const result = await trial.recover();
  assert.equal(result.noPaidRetry, true);
  assert.ok(calls.indexOf('claim') < calls.indexOf('kill-provider-transport'));
  assert.ok(calls.indexOf('kill-provider-transport') < calls.indexOf('stop'));
  assert.ok(calls.indexOf('revoke') < calls.indexOf('delete-user'));
  assert.equal(calls.at(-1), 'census');
  await assert.rejects(trial.recover(), /AI_020705_DETACHED_STOP_DENIED/u);
});

test('untrusted signature never grants stop authority', async () => {
  const { trial, calls } = build({ badKey: true });
  await assert.rejects(trial.recover(), /AI_020705_DETACHED_STOP_DENIED/u);
  assert.equal(calls.includes('claim'), false);
  assert.equal(calls.includes('stop'), false);
});

test('failed transport kill attempts runtime stop, but does not delete fixture', async () => {
  const { trial, calls } = build({ killFailed: true });
  await assert.rejects(trial.recover(), /AI_020705_DETACHED_STOP_DENIED/u);
  assert.ok(calls.includes('kill-provider-transport'));
  assert.ok(calls.includes('stop'));
  assert.equal(calls.includes('delete-user'), false);
  assert.ok(calls.includes('census'));
});
