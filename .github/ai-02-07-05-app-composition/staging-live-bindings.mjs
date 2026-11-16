// AI 02-07-05 real adapter composition for a trusted main-only Staging job.
// It reuses existing paid, consent, evidence and cleanup controls. No CLI,
// scheduler, client construction side effects, credentials or network at import.
// The independent watchdog and billing observers must already exist; this
// module never creates, impersonates, or self-certifies those authorities.
import { createClient } from '@supabase/supabase-js';
import { create020705StagingMigrationAdapter } from './staging-live-migrations.mjs';
import { create020705StagingPreviewAdapter } from './staging-live-preview.mjs';
import { create020705StagingJwtAdapter } from './staging-live-jwt.mjs';
import { create020705ProtectedComprehensiveStagingSequence } from './protected-live-composition.mjs';
import { createOwnerNovelBibleConsentPermissionCheck } from '../../api/_lib/ai/owner-novel-bible-consent.js';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const SHA = /^[a-f0-9]{40}$/u;

function deny() {
  throw new Error('AI_020705_STAGING_BINDING_DENIED');
}

export function create020705StagingLiveBindings({
  scope,
  credentials,
  controller,
  evidence,
  pricing,
  fetchImpl = globalThis.fetch
} = {}) {
  if (scope?.repository !== REPO ||
      scope?.prNumber !== 2895 ||
      scope?.stagingProjectRef !== STAGING ||
      scope?.supabaseUrl !== URL ||
      !SHA.test(scope?.mainSha ?? '') ||
      !SHA.test(scope?.candidateSha ?? '') ||
      scope.mainSha === scope.candidateSha ||
      typeof fetchImpl !== 'function' ||
      !credentials ||
      !controller ||
      !evidence ||
      !pricing ||
      !['verifyIndependentController','readIndependentWatchdogArm',
        'consumeWatchdogChallengeOnce','disableTrialEnvironment',
        'revokeSyntheticSessions','independentCensus'].every(
          (name) => typeof controller[name] === 'function'
        ) ||
      !controller.trustedControllerPublicKey ||
      typeof controller.trustedControllerKeyId !== 'string' ||
      typeof controller.expectedChallengeNonce !== 'string' ||
      !['readRunnerProtection','readBillingProtection',
        'readProviderRateProof'].every(
          (name) => typeof evidence[name] === 'function'
        ) ||
      typeof credentials.githubToken !== 'string' ||
      typeof credentials.supabaseSecretKey !== 'string' ||
      typeof credentials.supabasePublishableKey !== 'string' ||
      typeof credentials.databaseUrl !== 'string' ||
      typeof credentials.vercelToken !== 'string' ||
      typeof credentials.vercelProjectId !== 'string' ||
      typeof credentials.vercelProtectionBypass !== 'string' ||
      typeof credentials.openAiApiKey !== 'string' ||
      pricing.provider !== 'openai' ||
      pricing.model !== 'gpt-5.6-luna' ||
      !Number.isSafeInteger(pricing.inputMicrosPerMillion) ||
      !Number.isSafeInteger(pricing.outputMicrosPerMillion) ||
      !Number.isSafeInteger(pricing.maxOutputTokens)) deny();

  const admin = createClient(URL, credentials.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const migration = create020705StagingMigrationAdapter({
    scope, connectionString: credentials.databaseUrl,
    githubToken: credentials.githubToken, fetchImpl
  });
  const preview = create020705StagingPreviewAdapter({
    scope, token: credentials.vercelToken,
    projectId: credentials.vercelProjectId,
    teamId: credentials.vercelTeamId,
    protectionBypass: credentials.vercelProtectionBypass,
    fetchImpl
  });
  const jwt = create020705StagingJwtAdapter({
    scope, connectionString: credentials.databaseUrl,
    secretKey: credentials.supabaseSecretKey,
    publishableKey: credentials.supabasePublishableKey,
    serviceClient: admin
  });

  async function github(path, { method = 'GET', body } = {}) {
    if (!/^\/(?:git\/ref\/heads\/main|pulls\/2895|git\/ref\/heads\/staging%2Fai-02-07-05-[a-z0-9-]+|issues\/294\/comments(?:\?per_page=100&page=[1-9][0-9]*)?)$/u.test(path))
      deny();
    let response;
    try {
      response = await fetchImpl(
        'https://api.github.com/repos/' + REPO + path,
        {
          method, redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + credentials.githubToken,
            Accept: 'application/vnd.github+json',
            ...(body ? { 'Content-Type': 'application/json' } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(10000)
        }
      );
      if (![200, 201].includes(response?.status)) deny();
      return response.json();
    } catch { deny(); }
  }

  async function verifyOwnerAndRefs() {
    const [main, pr, branch] = await Promise.all([
      github('/git/ref/heads/main'),
      github('/pulls/2895'),
      github('/git/ref/heads/' + encodeURIComponent(scope.stagingBranch))
    ]);
    return main?.object?.sha === scope.mainSha &&
      pr?.number === 2895 && pr?.state === 'open' &&
      pr?.draft === true && pr?.merged !== true &&
      pr?.head?.sha === scope.candidateSha &&
      pr?.base?.sha === scope.mainSha &&
      branch?.object?.sha === scope.candidateSha;
  }

  async function readComments() {
    const comments = [];
    for (let i = 1; i <= 20; i += 1) {
      const batch = await github('/issues/294/comments?per_page=100&page=' + i);
      if (!Array.isArray(batch) || batch.length > 100) deny();
      comments.push(...batch);
      if (batch.length < 100) return comments;
    }
    deny();
  }

  async function writeComment(body) {
    if (typeof body !== 'string' ||
        !/^NOVELIGHT_STAGING_AI_020705_PAID_(?:CLAIMED|CONSUMED) /u.test(body))
      deny();
    await github('/issues/294/comments', {
      method: 'POST', body: { body }
    });
  }

  let proof = null;
  let verifiedPreview = null;
  return Object.freeze({
    async run() {
      // Never mutate even one Staging row until the independently
      // authenticated CONTROLLER is verified. A missing external Gate A
      // is a real NO-GO, not a flag that a GitHub runner can self-assert.
      if (await controller.verifyIndependentController(scope) !== true ||
          await evidence.readProviderRateProof(scope) !== true ||
          await evidence.readBillingProtection(scope) !== true) deny();
      const sequence = create020705ProtectedComprehensiveStagingSequence({
        scope,
        verifyOwnerAndRefs,
        verifyStagingIsolation: async () => {
          return scope.supabaseUrl === URL &&
            await controller.verifyIndependentController(scope) === true;
        },
        installReviewState: migration.installReviewState,
        installChunkClaim: migration.installChunkClaim,
        preparePreview: async () => {
          verifiedPreview = await preview.preparePreview();
          return verifiedPreview;
        },
        runSyntheticJwtProof: async () => {
          proof = await jwt.runSyntheticJwtProof();
          return proof;
        },
        getProtectedPaidConfig: async () => {
          if (!proof || !verifiedPreview) deny();
          const synthetic = jwt.synthetic;
          const expected = Object.freeze({
            actorId: proof.actorId,
            novelId: proof.novelId,
            episodeId: proof.episodeId,
            mainSha: scope.mainSha,
            candidateSha: scope.candidateSha,
            stagingBranch: scope.stagingBranch,
            previewDeploymentId: verifiedPreview.id,
            capMicros: scope.capMicros,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            stagingProjectRef: STAGING,
            expiresAt: scope.expiresAt,
            consentRevision: scope.consentRevision
          });
          const consent = createOwnerNovelBibleConsentPermissionCheck({
            enabled: true,
            ownerId: proof.actorId,
            serviceClient: admin,
            routes: { 'novel-bible': [pricing] },
            policyRevision: scope.consentRevision
          });
          return {
            context: {
              repository: REPO,
              githubActor: 'bingohooah888-ai',
              triggeringActor: 'bingohooah888-ai',
              protectedEnvironment: 'staging',
              trustedRef: 'refs/heads/main',
              vercelTarget: 'preview',
              projectRef: STAGING,
              supabaseUrl: URL,
              mainSha: scope.mainSha,
              candidateSha: scope.candidateSha,
              stagingBranch: scope.stagingBranch,
              candidateCheckoutSha: scope.candidateSha,
              trustedSha: scope.mainSha,
              previewDeploymentId: verifiedPreview.id,
              approvalCommentId: scope.approvalCommentId,
              runId: scope.runId
            },
            expected, synthetic, serviceClient: admin,
            authAdmin: admin.auth.admin,
            openAiApiKey: credentials.openAiApiKey,
            fetchImpl, route: pricing,
            readCurrentSynthetic: async () => {
              const [novel, episode] = await Promise.all([
                admin.from('novels').select('id,user_id')
                  .eq('id', proof.novelId).maybeSingle(),
                admin.from('episodes').select('id,novel_id,title,content')
                  .eq('id', proof.episodeId).maybeSingle()
              ]);
              if (novel.error || episode.error ||
                  novel.data?.user_id !== proof.actorId ||
                  episode.data?.novel_id !== proof.novelId) deny();
              return {
                verifiedSynthetic: true,
                novel: novel.data,
                episode: episode.data
              };
            },
            verifyCurrentConsent: consent,
            ledger: { readComments, writeComment },
            controller: {
              ...controller,
              independentCensus: controller.independentCensus
            },
            proofs: evidence.proofs,
            now: Date.now
          };
        },
        stopAndCleanup: async () => {
          // Also used when synthetic JWT proof fails midway.
          try {
            await controller.disableTrialEnvironment();
          } catch { /* still attempt the Staging cleanup */ }
          return jwt.emergencyCleanup();
        },
        independentFinalCensus: async () =>
          controller.independentCensus(scope) === true &&
          jwt.finalCensus() === true
      });
      try {
        return await sequence.run();
      } finally {
        await jwt.close();
      }
    }
  });
}
