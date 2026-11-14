import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { create020705ProtectedLiveComposition } from '../.github/ai-02-07-05-app-composition/protected-live-composition.mjs';

const NOW = Date.parse('2026-11-14T05:00:00Z');
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const OWNER = '11111111-1111-4111-8111-111111111111';
const MAIN = 'a'.repeat(40);
const KID = 'external-controller-01';
const NONCE = 'A'.repeat(44);
const keys = generateKeyPairSync('ed25519');
const ZERO = [
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
const content = '玲奈は青い鍵を拾った。鍵を持って港の灯台へ向かった。';
const modelText = JSON.stringify({
  suggestions: [
    {
      kind: 'character',
      key: '玲奈',
      summary: '青い鍵を拾い、灯台へ向かった。',
      evidence: '玲奈は青い鍵を拾った。'
    }
  ]
});

function scenario({
  consent = true,
  contentAfter = null,
  invalidModel = false,
  badBudget = false,
  badArm = false
} = {}) {
  const history = [];
  let httpPosts = 0;
  let loaded = 0;
  let claimed = false;
  let armSpent = false;
  const expiresAt = new Date(NOW + 15 * 60 * 1000).toISOString();
  const expected = {
    actorId: OWNER,
    novelId: 41,
    episodeId: 11,
    mainSha: MAIN,
    previewDeploymentId: 'dpl_test123',
    capMicros: 1000000,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    stagingProjectRef: STAGING,
    expiresAt,
    consentRevision: 'synthetic-policy'
  };
  const comments = [
    {
      id: 777,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body:
        'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
        JSON.stringify({
          actorId: OWNER,
          approvalScope: 'synthetic-one-provider-one-call-only',
          capMicros: expected.capMicros,
          confirmation: 'STAGING PAID 1 CALL APPROVED',
          consentRevision: 'synthetic-policy',
          episodeId: 11,
          expiresAt,
          mainSha: MAIN,
          model: 'gpt-5.6-luna',
          novelId: 41,
          previewDeploymentId: 'dpl_test123',
          provider: 'openai',
          stagingProjectRef: STAGING
        })
    }
  ];
  const reserveId = '22222222-2222-4222-8222-222222222222';
  function chain(result = { data: null, error: null }) {
    return {
      eq() {
        return this;
      },
      select() {
        return this;
      },
      maybeSingle: async () => ({
        data: { id: 41, user_id: OWNER },
        error: null
      }),
      then(resolve) {
        resolve(result);
      }
    };
  }
  const serviceClient = {
    supabaseUrl: URL,
    from(table) {
      return {
        select() {
          return chain();
        },
        insert() {
          history.push('audit:' + table);
          return { error: null };
        },
        update() {
          history.push('runtime-stop');
          return chain();
        },
        delete() {
          history.push('delete:' + table);
          return chain();
        }
      };
    },
    async rpc(name) {
      history.push(name);
      if (name === 'novelight_ai_reserve_usage')
        return { data: badBudget ? null : reserveId, error: null };
      if (name === 'novelight_ai_020705_claim_once') {
        if (claimed) return { data: false, error: null };
        claimed = true;
        return { data: true, error: null };
      }
      if (name === 'novelight_ai_settle_usage')
        return { data: true, error: null };
      throw new Error('unexpected RPC');
    }
  };
  const context = {
    repository: 'bingohooah888-ai/novelrise',
    githubActor: 'bingohooah888-ai',
    triggeringActor: 'bingohooah888-ai',
    protectedEnvironment: 'staging',
    trustedRef: 'refs/heads/main',
    vercelTarget: 'preview',
    projectRef: STAGING,
    supabaseUrl: URL,
    mainSha: MAIN,
    previewDeploymentId: 'dpl_test123',
    approvalCommentId: 777,
    runId: 1001
  };
  const proofs = Object.fromEntries(
    [
      'verifyCurrentMain',
      'verifyProtectedRunner',
      'verifyApprovedPreview',
      'verifyAtomicMigration',
      'verifySyntheticConsent',
      'verifyProviderBillingLimit'
    ].map((key) => [
      key,
      async () => {
        history.push(key);
        return true;
      }
    ])
  );
  const controller = {
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: KID,
    expectedChallengeNonce: NONCE,
    async readIndependentWatchdogArm(scope) {
      const receipt = {
        ...scope,
        kind: 'independent-controller-armed',
        protectedEnvironment: 'staging',
        controllerKind: 'external-independent-supervisor',
        controllerRunId: 9999,
        controllerIsRunner: false,
        killAuthorityVerified: true,
        stagingDisableVerified: true,
        sessionRevocationVerified: true,
        syntheticCleanupVerified: true,
        zeroCensusVerified: true,
        noPaidRetry: true,
        observedAtMs: NOW,
        heartbeatAtMs: NOW,
        expiresAtMs: NOW + 15000
      };
      return {
        domain: 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1',
        keyId: KID,
        challengeNonce: NONCE,
        receipt,
        signature: sign(
          null,
          Buffer.from(
            JSON.stringify([
              'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1',
              KID,
              NONCE,
              receipt
            ]),
            'utf8'
          ),
          keys.privateKey
        ).toString('base64url')
      };
    },
    async consumeWatchdogChallengeOnce() {
      history.push('arm');
      if (armSpent || badArm) return false;
      armSpent = true;
      return true;
    },
    disableTrialEnvironment: async () => {
      history.push('disable-preview');
      return true;
    },
    revokeSyntheticSessions: async () => {
      history.push('revoke');
      return true;
    },
    independentCensus: async () => {
      history.push('census');
      return {
        projectRef: STAGING,
        runtimeDisabledZero: true,
        approvalTombstoneCount: 1,
        ...Object.fromEntries(ZERO.map((key) => [key, 0]))
      };
    }
  };
  const trial = create020705ProtectedLiveComposition({
    context,
    expected,
    synthetic: {
      verifiedSynthetic: true,
      projectRef: STAGING,
      supabaseUrl: URL,
      userId: OWNER,
      novelId: 41,
      approvalCommentId: 777
    },
    serviceClient,
    authAdmin: {
      getUserById: async () => ({
        data: {
          user: {
            id: OWNER,
            email: 'novelight-ai-020705-synthetic@example.invalid',
            app_metadata: { internal_e2e: true }
          }
        },
        error: null
      }),
      deleteUser: async () => {
        history.push('delete-user');
        return { error: null };
      }
    },
    openAiApiKey: 'synthetic-no-network-secret',
    async fetchImpl(url, options) {
      httpPosts++;
      history.push('openai-post');
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.model, 'gpt-5.6-luna');
      assert.equal(body.max_output_tokens, 256);
      assert.match(body.input, /玲奈/u);
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: invalidModel
                    ? JSON.stringify({
                        suggestions: [
                          {
                            kind: 'character',
                            key: '玲奈',
                            summary: '存在しない証言',
                            evidence: '存在しない引用'
                          }
                        ]
                      })
                    : modelText
                }
              ]
            }
          ],
          usage: { input_tokens: 60, output_tokens: 100 }
        })
      };
    },
    route: {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      inputMicrosPerMillion: 10000,
      outputMicrosPerMillion: 20000,
      maxOutputTokens: 256
    },
    async readCurrentSynthetic() {
      loaded++;
      return {
        verifiedSynthetic: true,
        novel: { id: 41, user_id: OWNER },
        episode: {
          id: 11,
          novel_id: 41,
          title: '合成小説・第1話',
          content: contentAfter !== null && loaded >= 3 ? contentAfter : content
        }
      };
    },
    verifyCurrentConsent: async () => consent,
    ledger: {
      readComments: async () => comments,
      writeComment: async (body) => {
        history.push(
          body.includes('_CLAIMED ') ? 'owner-claim' : 'owner-consumed'
        );
        comments.push({
          id: 1001 + comments.length,
          user: { login: 'github-actions[bot]' },
          body
        });
      }
    },
    controller,
    proofs,
    now: () => NOW
  });
  return { trial, history, posts: () => httpPosts };
}

test('real OpenAI adapter + atomic budget + one-shot + verified synthetic review + cleanup', async () => {
  const x = scenario();
  assert.equal(x.trial.readVerifiedSyntheticAnalysis(), null);
  const result = await x.trial.run();
  assert.equal(result.outcome, 'one_call_succeeded_and_cleanup_verified');
  assert.equal(result.review.candidateCount, 1);
  assert.equal(result.review.verifiedEvidenceCount, 1);
  assert.ok(result.review.accountedMicros >= 0);
  assert.ok(result.review.accountedMicros <= 1000000);
  assert.equal(x.posts(), 1);
  assert.ok(
    x.history.indexOf('novelight_ai_reserve_usage') <
      x.history.indexOf('novelight_ai_020705_claim_once')
  );
  assert.ok(
    x.history.indexOf('novelight_ai_020705_claim_once') <
      x.history.indexOf('openai-post')
  );
  assert.ok(
    x.history.indexOf('openai-post') <
      x.history.indexOf('novelight_ai_settle_usage')
  );
  assert.ok(x.history.indexOf('delete-user') < x.history.indexOf('census'));
  assert.equal(x.history.at(-1), 'owner-consumed');
  assert.deepEqual(x.trial.readVerifiedSyntheticAnalysis(), [
    {
      kind: 'character',
      key: '玲奈',
      summary: '青い鍵を拾い、灯台へ向かった。',
      evidence: '玲奈は青い鍵を拾った。'
    }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /青い鍵/u);
  await assert.rejects(x.trial.run(), /AI_020705_LIVE_COMPOSITION_DENIED/u);
  assert.equal(x.posts(), 1);
});

test('budget refusal and missing external watchdog stop before any model POST', async () => {
  for (const mode of ['budget', 'watchdog']) {
    const x = scenario({
      badBudget: mode === 'budget',
      badArm: mode === 'watchdog'
    });
    await assert.rejects(x.trial.run());
    assert.equal(x.posts(), 0);
    assert.equal(x.trial.readVerifiedSyntheticAnalysis(), null);
    if (mode === 'budget') assert.ok(x.history.includes('owner-consumed'));
    else assert.equal(x.history.includes('owner-claim'), false);
  }
});

test('invalid citation or revoked consent never count as valid analysis', async () => {
  for (const config of [
    { invalidModel: true },
    { consent: false },
    { contentAfter: '異なる内容' }
  ]) {
    const x = scenario(config);
    await assert.rejects(x.trial.run());
    assert.equal(x.trial.readVerifiedSyntheticAnalysis(), null);
    assert.ok(x.history.includes('census'));
    assert.equal(x.history.at(-1), 'owner-consumed');
    assert.ok(x.posts() <= 1);
  }
});
