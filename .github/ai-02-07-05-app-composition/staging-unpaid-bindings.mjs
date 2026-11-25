// Dormant A/B/C-only adapter composition. No workflow or I/O at import.
// A trusted-main caller must supply independently authenticated Gate A
// evidence and durable unpaid OWNER admission; paid ARM/ledger are not substitutes.
// prettier-ignore
import { create020705UnpaidGateABCSequence } from '../staging-ai-02-07-05/comprehensive-staging-sequence.mjs';
// prettier-ignore
import { create020705StagingCleanup } from '../staging-ai-02-07-05/staging-synthetic-cleanup.mjs';
// prettier-ignore
import { create020705UnpaidMigrationInspector } from './staging-live-migrations.mjs';
// prettier-ignore
import { create020705UnpaidPreviewInspector } from './staging-live-preview.mjs';
// prettier-ignore
import { create020705UnpaidJwtAdapter } from './staging-live-jwt.mjs';
import { createClient } from '@supabase/supabase-js';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + REF + '.supabase.co';

function deny() {
  throw new Error('AI_020705_UNPAID_BINDINGS_NO_GO');
}

// prettier-ignore
export function create020705UnpaidStagingBindings({
  scope, credentials, authority, controller, fetchImpl = globalThis.fetch
} = {}) {
  if (scope?.repository !== 'bingohooah888-ai/novelrise' ||
      scope?.stagingProjectRef !== REF || scope.supabaseUrl !== URL ||
      scope.maxPaidCalls !== 0 || scope.capMicros !== 0 ||
      scope.maxMigrations !== 0 || scope.maxPreviews !== 0 ||
      scope.existingMigrationsOnly !== true || scope.existingPreviewOnly !== true ||
      !credentials || !authority || !controller ||
      ['openAiApiKey', 'modelApiKey'].some((key) => Object.hasOwn(credentials, key)) ||
      !['verifyOwnerAndRefs', 'verifyIndependentGateA',
        'verifyStagingIsolation', 'consumeUnpaidApprovalOnce'].every(
        (key) => typeof authority[key] === 'function') ||
      !['disableTrialEnvironment', 'revokeSyntheticSessions', 'independentCensus'].every(
        (key) => typeof controller[key] === 'function')) deny();
  scope = Object.freeze({ ...scope });
  let attempted = false;
  return Object.freeze({
    async run() {
      if (attempted) deny();
      attempted = true;
      if (await authority.verifyOwnerAndRefs(scope) !== true ||
          await authority.verifyIndependentGateA(scope) !== true ||
          await authority.verifyStagingIsolation(scope) !== true) deny();
      const admin = createClient(URL, credentials.supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const migration = create020705UnpaidMigrationInspector({
        scope, connectionString: credentials.databaseUrl,
        githubToken: credentials.githubToken, fetchImpl
      });
      const preview = create020705UnpaidPreviewInspector({
        scope, token: credentials.vercelToken,
        projectId: credentials.vercelProjectId, teamId: credentials.vercelTeamId,
        protectionBypass: credentials.vercelProtectionBypass,
        existingDeploymentId: scope.previewDeploymentId, fetchImpl
      });
      const jwt = create020705UnpaidJwtAdapter({
        scope, connectionString: credentials.databaseUrl,
        secretKey: credentials.supabaseSecretKey,
        publishableKey: credentials.supabasePublishableKey, serviceClient: admin
      });
      const target = Object.freeze({
        projectRef: REF, userId: scope.actorId,
        novelId: scope.novelId, approvalCommentId: scope.approvalCommentId
      });
      let cleanup = null;
      const census = async (input) => {
        const report = await controller.independentCensus(input);
        if (report?.sourceKind !== 'SEPARATE_STAGING_READONLY_CENSUS' ||
            report.chunkClaimsRetained !== 0) deny();
        return report;
      };
      try {
        return await create020705UnpaidGateABCSequence({
          scope,
          verifyOwnerAndRefs: (s) => authority.verifyOwnerAndRefs(s),
          verifyIndependentGateA: (s) => authority.verifyIndependentGateA(s),
          verifyStagingIsolation: (s) => authority.verifyStagingIsolation(s),
          inspectInstalled: migration.inspectInstalled,
          preparePreview: preview.preparePreview,
          beforeSynthetic: (s) => authority.consumeUnpaidApprovalOnce(s),
          runSyntheticJwtProof: async () => {
            const proof = await jwt.runSyntheticJwtProof();
            if (proof?.verifiedSynthetic !== true ||
                proof.actorId !== scope.actorId || proof.novelId !== scope.novelId ||
                proof.episodeId !== scope.episodeId) deny();
            cleanup = create020705StagingCleanup({
              serviceClient: admin, authAdmin: admin.auth.admin,
              synthetic: {
                verifiedSynthetic: true, projectRef: REF, supabaseUrl: URL,
                userId: proof.actorId, novelId: proof.novelId,
                approvalCommentId: scope.approvalCommentId
              },
              disableTrialEnvironment: () => controller.disableTrialEnvironment(),
              revokeSyntheticSessions: (id) => controller.revokeSyntheticSessions(id),
              independentCensus: census
            });
            return proof;
          },
          stopAndCleanup: async () => {
            if (cleanup) {
              if (await cleanup.stop() !== true) return false;
              return (await cleanup.cleanup()) === true;
            }
            try { await controller.disableTrialEnvironment(); } catch { /* continue */ }
            try { await jwt.emergencyCleanup(); } catch { /* no PASS */ }
            return false;
          },
          independentFinalCensus: async () => {
            if (!cleanup) { await census(target); return false; }
            return (await cleanup.finalCensus()) === true &&
              (await jwt.finalCensus()) === true;
          }
        }).run();
      } finally {
        await jwt.close();
      }
    }
  });
}
