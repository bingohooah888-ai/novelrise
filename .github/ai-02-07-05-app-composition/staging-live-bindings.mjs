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
import { inspect020705OwnerLedger, inspect020705PostRunOwnerApproval, verify020705ClaimedOwnerApproval, claim020705OwnerApproval, consume020705OwnerApproval } from '../staging-ai-02-07-05/owner-paid-trial-ledger.mjs';
import { create020705AuthenticatedArmReaderCandidate, project020705ArmScope, create020705RunnerArmChannelPorts } from '../staging-ai-02-07-05/gatea-controller-arm-reader-candidate.mjs';
import { verify020705SignedWatchdogArm } from '../staging-ai-02-07-05/signed-watchdog-arm.mjs';
import { verify020705SignedRunnerDeath } from '../staging-ai-02-07-05/signed-runner-death-offline.mjs';
import { createOwnerNovelBibleConsentPermissionCheck } from '../../api/_lib/ai/owner-novel-bible-consent.js';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const SHA = /^[a-f0-9]{40}$/u;

function deny() {
  throw new Error('AI_020705_STAGING_BINDING_DENIED');
}

/**
 * Read-only, cryptographically authenticated independent Gate A observation.
 * Until an independently deployed, genuinely stopping controller signs a
 * matching receipt, all Staging mutation stays NO-GO. The existing reader
 * caches that exact short-lived receipt; the paid boundary consumes it.
 * A metadata boolean, runner heartbeat or self-signed fixture is not proof.
 */
export async function inspect020705IndependentGateABeforeMutation({
  scope,
  controller,
  now = Date.now
} = {}) {
  if (scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGING ||
      scope?.supabaseUrl !== URL ||
      !SHA.test(scope?.mainSha ?? '') ||
      !SHA.test(scope?.candidateSha ?? '') ||
      scope?.capMicros > 1000000 ||
      typeof controller?.verifyIndependentController !== 'function' ||
      typeof controller?.inspectIndependentWatchdogArm !== 'function' ||
      !controller?.trustedControllerPublicKey ||
      typeof controller?.trustedControllerKeyId !== 'string' ||
      typeof controller?.expectedChallengeNonce !== 'string' ||
      typeof now !== 'function') return false;
  try {
    const armScope = project020705ArmScope(scope);
    if (await controller.verifyIndependentController(armScope) !== true) {
      return false;
    }
    const envelope = await controller.inspectIndependentWatchdogArm(armScope);
    return verify020705SignedWatchdogArm({
      scope: armScope,
      envelope,
      trustedControllerPublicKey: controller.trustedControllerPublicKey,
      trustedControllerKeyId: controller.trustedControllerKeyId,
      expectedChallengeNonce: controller.expectedChallengeNonce,
      now
    }) === true;
  } catch {
    return false;
  }
}

/**
 * Connects to the EXISTING Cloudflare Gate A candidate's authenticated
 * /_novelight/gatea/receipt endpoint AFTER independently verified runner
 * death. This is a death/cleanup RECOVERY reader, never an active arm or
 * permission to call a provider. The Worker is currently dormant; a 404
 * or missing signed reply remains NO-GO.
 */
export function create020705CloudflareDeathReceiptReader({
  scope,
  workerOrigin,
  ownerReadSignature,
  challengeNonce,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  fetchImpl = globalThis.fetch
} = {}) {
  const nonceFormat = /^[A-Za-z0-9_-]{32,128}$/u;
  const signatureFormat = /^[A-Za-z0-9_-]{86}$/u;
  const keys = [
    'repository', 'stagingProjectRef', 'mainSha',
    'previewDeploymentId', 'actorId', 'novelId',
    'episodeId', 'runId', 'approvalCommentId'
  ];
  let parsed;
  try { parsed = new globalThis.URL(workerOrigin); }
  catch { deny(); }
  if (scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGING ||
      !SHA.test(scope?.mainSha ?? '') ||
      !/^dpl_[A-Za-z0-9]+$/u.test(scope?.previewDeploymentId ?? '') ||
      !nonceFormat.test(challengeNonce ?? '') ||
      !signatureFormat.test(ownerReadSignature ?? '') ||
      !trustedControllerPublicKey ||
      typeof trustedControllerKeyId !== 'string' ||
      typeof fetchImpl !== 'function' ||
      parsed.protocol !== 'https:' ||
      parsed.username !== '' || parsed.password !== '' ||
      parsed.search !== '' || parsed.hash !== '' ||
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      !/^novelight-ai-gatea-watchdog\.[a-z0-9-]+\.workers\.dev$/u
        .test(parsed.hostname) ||
      (parsed.port !== '' && parsed.port !== '443') ||
      keys.some((key) => scope[key] == null)) deny();

  const exact = Object.freeze(Object.fromEntries(
    keys.map((key) => [key, scope[key]])
  ));
  let attempted = false;
  return Object.freeze({
    async readIndependentDeathProof(readScope) {
      if (attempted ||
          keys.some((key) => readScope?.[key] !== exact[key])) deny();
      attempted = true;
      try {
        const response = await fetchImpl(
          parsed.origin + '/_novelight/gatea/receipt',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scope: exact,
              nonce: challengeNonce,
              signature: ownerReadSignature
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(10000)
          }
        );
        if (response.status !== 200 ||
            !/application\/json/u.test(response.headers.get('content-type') ?? ''))
          deny();
        const raw = await response.text();
        if (raw.length > 8192) deny();
        const data = JSON.parse(raw);
        if (data?.authorizesMutation !== false ||
            data?.authorizesPaidCall !== false ||
            !verify020705SignedRunnerDeath({
              envelope: data.envelope,
              trustedControllerPublicKey,
              trustedControllerKeyId,
              expectedChallengeNonce: challengeNonce
            }) ||
            keys.some((key) => data.envelope.proof[key] !== exact[key])) deny();
        // The existing detached-stop connector additionally checks
        // freshness, independent run ID, death state, durable recovery
        // claim, actual STOP and independent zero-residue census.
        return data.envelope;
      } catch { deny(); }
    }
  });
}

// Separate signed observer returns a scoped readback object, never a
// caller-supplied boolean. A mismatched query or report must fail closed.
// This function validates the shape; the injected observer must verify
// Ed25519 and actual independent Staging readback before returning it.
// prettier-ignore
const CENSUS_ZERO = [
  'users', 'identities', 'sessions', 'profiles', 'novels', 'episodes',
  'facts', 'analysis', 'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit'
];
// prettier-ignore
const CENSUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// prettier-ignore
export async function verify020705IndependentStagingCensus({
  scope, independentCensus
} = {}) {
  if (scope?.stagingProjectRef !== STAGING ||
      !CENSUS_UUID.test(scope?.actorId ?? '') ||
      !Number.isSafeInteger(scope?.novelId) || scope.novelId <= 0 ||
      !Number.isSafeInteger(scope?.approvalCommentId) ||
      scope.approvalCommentId <= 0 ||
      typeof independentCensus !== 'function') return false;
  const target = Object.freeze({
    projectRef: STAGING, userId: scope.actorId,
    novelId: scope.novelId, approvalCommentId: scope.approvalCommentId
  });
  try {
    const report = await independentCensus(target);
    return report?.sourceKind === 'SEPARATE_STAGING_READONLY_CENSUS' &&
      report.projectRef === target.projectRef &&
      report.userId === target.userId &&
      report.novelId === target.novelId &&
      report.approvalCommentId === target.approvalCommentId &&
      report.runtimeDisabledZero === true &&
      report.approvalTombstoneCount === 1 &&
      Number.isSafeInteger(report.chunkClaimsRetained) &&
      report.chunkClaimsRetained >= 0 &&
      report.chunkClaimsRetained <= 1 &&
      CENSUS_ZERO.every((key) => report[key] === 0);
  } catch {
    return false;
  }
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
      scope.existingMigrationsOnly !== true ||
      scope.existingPreviewOnly !== true ||
      typeof scope.previewDeploymentId !== 'string' ||
      !/^dpl_[A-Za-z0-9]+$/u.test(scope.previewDeploymentId) ||
      typeof scope.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(scope.expiresAt)) ||
      typeof scope.consentRevision !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{3,119}$/iu.test(scope.consentRevision) ||
      typeof scope.actorId !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(scope.actorId) ||
      !Number.isSafeInteger(scope.novelId) ||
      !Number.isSafeInteger(scope.episodeId) ||
      !Number.isSafeInteger(scope.runId) ||
      scope.runId <= 0 ||
      !Number.isSafeInteger(scope.intentCommentId) ||
      scope.intentCommentId <= 0 ||
      !Number.isSafeInteger(scope.approvalCommentId) ||
      scope.approvalCommentId <= 0 ||
      !Number.isSafeInteger(scope.capMicros) ||
      scope.capMicros < 1 || scope.capMicros > 1000000 ||
      typeof fetchImpl !== 'function' ||
      !credentials ||
      !controller ||
      !evidence ||
      !pricing ||
      !['readControllerIdentity','verifyControllerIdentityAttestation',
        'disableTrialEnvironment',
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
      pricing.model !== 'gpt-6.1-sol' ||
      !Number.isSafeInteger(pricing.inputMicrosPerMillion) ||
      !Number.isSafeInteger(pricing.outputMicrosPerMillion) ||
      !Number.isSafeInteger(pricing.maxOutputTokens)) deny();

  // Compose the existing Reader with authenticated off-Runner ports only.
  // No raw HMAC/key signing, public transport or fallback is supplied here.
  scope = Object.freeze({ ...scope });
  const armScope = project020705ArmScope(scope);
  const armReader = create020705AuthenticatedArmReaderCandidate({
    ...controller,
    ...create020705RunnerArmChannelPorts({
      scope: armScope, armChannel: controller.armChannel
    })
  });
  controller = Object.freeze({ ...controller, ...armReader });
  let ownerClaimed = false;
  let attempted = false;
  const ownerExpected = Object.freeze({
    actorId: scope.actorId, novelId: scope.novelId, episodeId: scope.episodeId,
    mainSha: scope.mainSha, candidateSha: scope.candidateSha,
    stagingBranch: scope.stagingBranch, repository: REPO, runId: scope.runId,
    approvalIssueNumber: 294, previewDeploymentId: scope.previewDeploymentId,
    capMicros: scope.capMicros, consentRevision: scope.consentRevision,
    expiresAt: scope.expiresAt, provider: 'openai', model: 'gpt-6.1-sol',
    stagingProjectRef: STAGING
  });

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
    existingDeploymentId: scope.previewDeploymentId,
    fetchImpl
  });
  const jwt = create020705StagingJwtAdapter({
    scope, connectionString: credentials.databaseUrl,
    secretKey: credentials.supabaseSecretKey,
    publishableKey: credentials.supabasePublishableKey,
    serviceClient: admin
  });

  async function github(path, { method = 'GET', body } = {}) {
    if (!/^\/(?:git\/ref\/heads\/main|pulls\/2895|issues\/294|git\/ref\/heads\/staging%2Fai-02-07-05-[a-z0-9-]+|issues\/294\/comments(?:\?per_page=100&page=[1-9][0-9]*)?)$/u.test(path))
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
    const [main, pr, branch, issue, comments] = await Promise.all([
      github('/git/ref/heads/main'),
      github('/pulls/2895'),
      github('/git/ref/heads/' + encodeURIComponent(scope.stagingBranch)),
      github('/issues/294'),
      readComments()
    ]);
    if (main?.object?.sha !== scope.mainSha ||
        pr?.number !== 2895 || pr?.state !== 'open' ||
        pr?.draft !== true || pr?.merged === true ||
        pr?.head?.sha !== scope.candidateSha ||
        pr?.base?.sha !== scope.mainSha ||
        branch?.object?.sha !== scope.candidateSha ||
        issue?.number !== 294 ||
        issue?.title !== '[Staging Control] Supabase migration sync' ||
        issue?.state !== 'open' ||
        issue?.user?.login !== 'bingohooah888-ai') return false;
    try {
      const afterRun = inspect020705PostRunOwnerApproval({
        comments,
        intentCommentId: scope.intentCommentId,
        runId: scope.runId,
        mainSha: scope.mainSha,
        candidateSha: scope.candidateSha,
        stagingBranch: scope.stagingBranch,
        expectClaimed: ownerClaimed,
        now: Date.now()
      });
      if (afterRun.approvalCommentId !== scope.approvalCommentId ||
          afterRun.previewDeploymentId !== scope.previewDeploymentId ||
          afterRun.capMicros !== scope.capMicros ||
          afterRun.authorizesPaidCall !== false) return false;
      const inspect = ownerClaimed
        ? verify020705ClaimedOwnerApproval : inspect020705OwnerLedger;
      inspect({
        comments, approvalCommentId: scope.approvalCommentId,
        expected: ownerExpected, runId: scope.runId, now: Date.now()
      });
      return true;
    } catch {
      return false;
    }
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
      if (attempted) deny();
      attempted = true;
      // Before read-only inspection, verify protected Runner and billing.
      // Issue ARM as close as possible to fixture creation, without extending
      // its existing TTL. Missing independent evidence remains NO-GO.
      if (await evidence.readRunnerProtection(scope) !== true ||
          await evidence.readProviderRateProof(scope) !== true ||
          await evidence.readBillingProtection(scope) !== true) deny();
      const sequence = create020705ProtectedComprehensiveStagingSequence({
        scope,
        verifyOwnerAndRefs,
        verifyStagingIsolation: async () => {
          return scope.supabaseUrl === URL &&
            await controller.verifyIndependentController(armScope) === true;
        },
        // A paid-one-shot approval is not a migration installation approval.
        // Inspect the already approved pair; never apply DDL in this job.
        installReviewState: migration.inspectInstalled,
        installChunkClaim: migration.inspectInstalled,
        preparePreview: async () => {
          verifiedPreview = await preview.preparePreview();
          return verifiedPreview;
        },
        beforeSynthetic: async () => {
          if (await verifyOwnerAndRefs() !== true ||
              (await inspect020705IndependentGateABeforeMutation({
                scope, controller
              })) !== true) return false;
          // ARM issuance requires the unclaimed OWNER ledger. Claim only
          // after verifying the signed ARM and before synthetic mutation.
          // The claim is retained if the Runner dies or cleanup fails.
          await claim020705OwnerApproval({
            readComments, writeComment, approvalCommentId: scope.approvalCommentId,
            expected: ownerExpected, runId: scope.runId, now: Date.now
          });
          ownerClaimed = true;
          // Read-only revalidation does not issue or spend another ARM.
          return (await inspect020705IndependentGateABeforeMutation({
            scope, controller
          })) === true;
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
            model: 'gpt-6.1-sol',
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
            ledger: { readComments, writeComment, ownerLedgerAlreadyClaimed: true },
            controller: {
              ...controller,
              independentCensus: controller.independentCensus
            },
            proofs: evidence.proofs,
            now: Date.now
          };
        },
        stopAndCleanup: async () => {
          // Continue cleanup even if kill switch fails, but NEVER report PASS.
          let stopped = false;
          let cleaned = false;
          try {
            stopped = (await controller.disableTrialEnvironment()) === true;
          } catch { /* still attempt cleanup */ }
          try {
            cleaned = (await jwt.emergencyCleanup()) === true;
          } catch { /* retain cleanup failure */ }
          return stopped && cleaned;
        },
        independentFinalCensus: async () =>
          (await verify020705IndependentStagingCensus({
            scope, independentCensus: controller.independentCensus
          })) === true &&
          (await jwt.finalCensus()) === true
      });
      try {
        const outcome = await sequence.run();
        if (!ownerClaimed || outcome?.outcome !== 'STAGING_SEQUENCE_PASS') deny();
        // Only the outer Runner finalizes the early claim. If anything fails,
        // retain CLAIMED for independent recovery; it cannot admit a retry.
        await consume020705OwnerApproval({
          writeComment, approvalCommentId: scope.approvalCommentId,
          runId: scope.runId, result: 'success'
        });
        return outcome;
      } finally {
        await jwt.close();
      }
    }
  });
}
