// 02-07-05: connect EXISTING Staging-only controls to the real provider.
// Dormant composition: no CLI, workflow dispatch, environment fallback or I/O
// at import time. A separately approved protected runner supplies each live
// capability. Do not import this file from public APIs or browser code.
import { createHash } from 'node:crypto';
import { create020705ProtectedStageExecutor } from '../staging-ai-02-07-05/protected-stage-executor.mjs';
import { createPaidTrialOneShotOpenAiProvider } from '../staging-ai-02-07-05/paid-trial-one-shot-provider.mjs';
import { createOpenAiTextProvider } from '../../api/_lib/ai/providers.js';
import { createAiRouter } from '../../api/_lib/ai/router.js';
import {
  createSupabaseAiBudget,
  createSupabaseAiAudit
} from '../../api/_lib/ai/supabase-store.js';
import {
  materializeNovelBibleChunk,
  planNovelBibleChangedChunks
} from '../../api/_lib/ai/novel-bible-chunks.js';
import { reviewNovelBibleInference } from '../../api/_lib/ai/novel-bible-inference-review.js';
import { NOVEL_BIBLE_INFERENCE_SYSTEM } from '../../api/_lib/ai/owner-novel-bible-model-bridge.js';

const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING_URL = 'https://' + STAGING_REF + '.supabase.co';
const MODEL = 'gpt-5.6-luna';
const HASH = /^[0-9a-f]{64}$/u;
const keys = Object.freeze([
  'provider',
  'model',
  'inputMicrosPerMillion',
  'outputMicrosPerMillion',
  'maxOutputTokens'
]);

function deny() {
  throw new Error('AI_020705_LIVE_COMPOSITION_DENIED');
}
const digest = (text) => createHash('sha256').update(text).digest('hex');

function validateSource(snapshot, synthetic, expected) {
  const novel = snapshot?.novel;
  const episode = snapshot?.episode;
  if (
    snapshot?.verifiedSynthetic !== true ||
    novel?.id !== expected.novelId ||
    novel?.user_id !== synthetic.userId ||
    episode?.id !== expected.episodeId ||
    episode?.novel_id !== novel.id ||
    typeof episode?.title !== 'string' ||
    typeof episode?.content !== 'string' ||
    Buffer.byteLength(episode.content, 'utf8') < 1 ||
    Buffer.byteLength(episode.content, 'utf8') > 4096
  )
    deny();
  const principal = { id: synthetic.userId };
  const plan = planNovelBibleChangedChunks({
    principal,
    novel,
    episodes: [episode],
    analyses: [],
    limit: 1
  });
  if (plan.chunks.length !== 1) deny();
  const chunk = plan.chunks[0];
  const materialized = materializeNovelBibleChunk({
    principal,
    novel,
    episode,
    chunk
  });
  return { principal, novel, episode, chunk, materialized };
}

function validateRoute(route, expected, system, user) {
  if (
    !route ||
    typeof route !== 'object' ||
    Array.isArray(route) ||
    Object.keys(route).sort().join(',') !== [...keys].sort().join(',') ||
    route.provider !== 'openai' ||
    route.model !== MODEL ||
    !Number.isSafeInteger(route.inputMicrosPerMillion) ||
    route.inputMicrosPerMillion <= 0 ||
    !Number.isSafeInteger(route.outputMicrosPerMillion) ||
    route.outputMicrosPerMillion <= 0 ||
    !Number.isSafeInteger(route.maxOutputTokens) ||
    route.maxOutputTokens < 1 ||
    route.maxOutputTokens > 4096
  )
    deny();
  const worstCaseMicros = Math.ceil(
    (Buffer.byteLength(system + user, 'utf8') * route.inputMicrosPerMillion +
      route.maxOutputTokens * route.outputMicrosPerMillion) /
      1000000
  );
  if (
    !Number.isSafeInteger(worstCaseMicros) ||
    worstCaseMicros < 1 ||
    worstCaseMicros > expected.capMicros ||
    worstCaseMicros > 10000000
  )
    deny();
  return worstCaseMicros;
}

/**
 * Actual call sequence, only when run() is invoked by a protected runner:
 * verified synthetic source -> existing six live proofs -> signed external
 * watchdog -> OWNER ledger claim -> atomic Supabase budget reserve ->
 * DB one-shot claim -> one OpenAI Responses POST -> settle/audit ->
 * existing excerpt-grounded review -> stop/cleanup/independent census ->
 * consumed OWNER ledger. Any failure is terminal; no retry or fallback.
 *
 * readCurrentSynthetic and verifyCurrentConsent must be independently
 * authenticated Staging-only readers. A caller-supplied flag is not proof.
 * Controller callbacks MUST be backed by a separate approved process.
 */
export function create020705ProtectedLiveComposition({
  context,
  expected,
  synthetic,
  serviceClient,
  authAdmin,
  openAiApiKey,
  fetchImpl,
  route,
  readCurrentSynthetic,
  verifyCurrentConsent,
  ledger,
  controller,
  proofs,
  now = Date.now
} = {}) {
  if (
    serviceClient?.supabaseUrl !== STAGING_URL ||
    synthetic?.projectRef !== STAGING_REF ||
    synthetic?.supabaseUrl !== STAGING_URL ||
    synthetic?.verifiedSynthetic !== true ||
    expected?.stagingProjectRef !== STAGING_REF ||
    expected?.actorId !== synthetic.userId ||
    expected?.novelId !== synthetic.novelId ||
    expected?.provider !== 'openai' ||
    expected?.model !== MODEL ||
    !Number.isSafeInteger(expected?.capMicros) ||
    expected.capMicros < 1 ||
    expected.capMicros > 10000000 ||
    typeof openAiApiKey !== 'string' ||
    openAiApiKey.length < 16 ||
    typeof fetchImpl !== 'function' ||
    typeof readCurrentSynthetic !== 'function' ||
    typeof verifyCurrentConsent !== 'function' ||
    typeof ledger?.readComments !== 'function' ||
    typeof ledger?.writeComment !== 'function' ||
    typeof controller?.readIndependentWatchdogArm !== 'function' ||
    typeof controller?.consumeWatchdogChallengeOnce !== 'function' ||
    typeof controller?.disableTrialEnvironment !== 'function' ||
    typeof controller?.revokeSyntheticSessions !== 'function' ||
    typeof controller?.independentCensus !== 'function' ||
    !controller?.trustedControllerPublicKey ||
    typeof controller?.trustedControllerKeyId !== 'string' ||
    typeof controller?.expectedChallengeNonce !== 'string' ||
    typeof now !== 'function'
  )
    deny();

  let attempted = false;
  let reviewed = null;
  let succeeded = false;
  return Object.freeze({
    async run() {
      if (attempted) deny();
      attempted = true;
      // This reader runs only inside a separately approved Staging attempt.
      const original = validateSource(
        await readCurrentSynthetic(),
        synthetic,
        expected
      );
      const request = Object.freeze({
        model: MODEL,
        system: NOVEL_BIBLE_INFERENCE_SYSTEM,
        user: JSON.stringify({
          task: 'Extract review candidates from this one synthetic excerpt',
          untrusted_excerpt: original.materialized.text
        })
      });
      validateRoute(route, expected, request.system, request.user);
      // Do not provision a new provider or price registry; use the existing
      // OpenAI Responses adapter and the existing cost/accounting Router.
      const guardedProvider = createPaidTrialOneShotOpenAiProvider({
        serviceClient,
        underlyingProvider: createOpenAiTextProvider({
          apiKey: openAiApiKey,
          fetchImpl
        }),
        approved: {
          commentId: context.approvalCommentId,
          ownerId: expected.actorId,
          novelId: expected.novelId,
          episodeId: expected.episodeId,
          provider: 'openai',
          model: MODEL,
          routeCount: 1,
          maxProviderCalls: 1,
          noRetry: true,
          fallbackDisabled: true,
          capMicros: expected.capMicros,
          mainSha: expected.mainSha,
          ...(expected.candidateSha
            ? {
                candidateSha: expected.candidateSha,
                stagingBranch: expected.stagingBranch
              }
            : {}),
          previewDeploymentId: expected.previewDeploymentId,
          expiresAt: expected.expiresAt,
          ownerLedgerClaimed: true,
          exactScopeVerified: true
        },
        deployment: {
          projectRef: STAGING_REF,
          supabaseUrl: STAGING_URL,
          isProduction: false,
          ready: true,
          sha: expected.candidateSha ?? expected.mainSha,
          branch: expected.stagingBranch,
          id: expected.previewDeploymentId
        },
        now
      });
      let accountedMicros = null;
      const storeBudget = createSupabaseAiBudget({ serviceClient });
      const meteredBudget = Object.freeze({
        async reserve(args) {
          if (args.ceilingMicros > expected.capMicros) deny();
          return storeBudget.reserve(args);
        },
        async settle(args) {
          await storeBudget.settle(args);
          accountedMicros = args.chargedMicros;
        }
      });
      const router = createAiRouter({
        enabled: true,
        cache: null,
        authorize: async ({ feature, principal, workId }) => {
          if (
            feature?.key !== 'novel-bible' ||
            principal?.id !== synthetic.userId ||
            workId !== synthetic.novelId
          )
            return false;
          if (
            (await verifyCurrentConsent({
              actorId: synthetic.userId,
              novelId: synthetic.novelId,
              episodeId: expected.episodeId,
              purpose: 'external-novel-bible-analysis'
            })) !== true
          )
            return false;
          try {
            const current = validateSource(
              await readCurrentSynthetic(),
              synthetic,
              expected
            );
            return (
              current.materialized.chunkHash ===
                original.materialized.chunkHash &&
              current.materialized.sourceHash ===
                original.materialized.sourceHash
            );
          } catch {
            return false;
          }
        },
        budget: meteredBudget,
        audit: createSupabaseAiAudit({ serviceClient }),
        providers: { openai: guardedProvider },
        routes: { 'novel-bible': [route] }
      });
      const executor = create020705ProtectedStageExecutor({
        context,
        expected,
        synthetic,
        serviceClient,
        authAdmin,
        guardedProvider,
        request,
        invokeModel: () =>
          router.run({
            featureKey: 'novel-bible',
            principal: original.principal,
            workId: expected.novelId,
            revision: original.materialized.chunkHash,
            system: request.system,
            user: request.user
          }),
        reviewResponse: async (modelText) => {
          const fresh = validateSource(
            await readCurrentSynthetic(),
            synthetic,
            expected
          );
          if (
            fresh.materialized.sourceHash !==
              original.materialized.sourceHash ||
            fresh.materialized.chunkHash !== original.materialized.chunkHash ||
            (await verifyCurrentConsent({
              actorId: synthetic.userId,
              novelId: synthetic.novelId,
              episodeId: expected.episodeId,
              purpose: 'external-novel-bible-analysis'
            })) !== true
          )
            deny();
          const review = reviewNovelBibleInference({
            ...original,
            sourceHash: original.materialized.sourceHash,
            modelText,
            authorConfirmedFacts: []
          });
          if (
            !review.candidates.length ||
            review.candidates.some(
              (candidate) =>
                !original.materialized.text.includes(
                  candidate.factPayload.evidence
                )
            )
          )
            deny();
          // Confidential in-process owner inspection; never emit via Actions.
          reviewed = Object.freeze(
            review.candidates.map((candidate) =>
              Object.freeze({
                kind: candidate.factKind,
                key: candidate.factKey,
                summary: candidate.factPayload.summary,
                evidence: candidate.factPayload.evidence
              })
            )
          );
          return Object.freeze({
            candidateCount: reviewed.length,
            verifiedEvidenceCount: reviewed.length,
            accountedMicros,
            sourceHash: original.materialized.sourceHash,
            responseHash: digest(modelText)
          });
        },
        readComments: ledger.readComments,
        writeComment: ledger.writeComment,
        disableTrialEnvironment: controller.disableTrialEnvironment,
        revokeSyntheticSessions: controller.revokeSyntheticSessions,
        independentCensus: controller.independentCensus,
        readIndependentWatchdogArm: controller.readIndependentWatchdogArm,
        consumeWatchdogChallengeOnce: controller.consumeWatchdogChallengeOnce,
        trustedControllerPublicKey: controller.trustedControllerPublicKey,
        trustedControllerKeyId: controller.trustedControllerKeyId,
        expectedChallengeNonce: controller.expectedChallengeNonce,
        proofs,
        now
      });
      const outcome = await executor.run();
      succeeded = true;
      return outcome; // hashes and counts only
    },
    // Trusted same-process owner inspector, AFTER cleanup/census success.
    readVerifiedSyntheticAnalysis() {
      return succeeded ? reviewed : null;
    }
  });
}
