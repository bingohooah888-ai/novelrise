// Formal release application composition. Not a Vercel API route.
// Uses the existing canonical XP/Point readers, transactional usage service,
// authenticated HTTP handlers, and approved earning worker without starting them.
// This module creates no connection, migration, job, endpoint, or feature flag.
import { createUnregisteredFormalPostgresRewardHost } from './formal-usage-host.js';
import { createFormalEarningRunner } from './formal-earning-runner.js';
import { createUnregisteredFormalOpeningSync } from './formal-opening-sync.js';
import { createUnregisteredFormalNewReaderOnboarding } from './formal-new-reader-onboarding.js';
import { createUnregisteredFormalApiDispatch } from './formal-api-dispatch.js';
import { createFormalCanonicalSourceReader } from './formal-earning-source-reader.js';

export function createUnregisteredFormalApplication({
  pool,
  supabase,
  unitVerification,
  now,
  releaseConfiguration,
  trustedServerAuthorization,
  releaseTimestampIso,
  stagingTestReferenceAt,
  verifyModeratorReceipt,
  stagingRef,
  env,
  catalog,
  policy,
  aiExecutor,
  verifyGiftReceipt,
  verifyGiftNonFulfillment,
  verifyGiftRefund,
  verifyAiRefund
} = {}) {
  if (
    typeof pool?.connect !== 'function' ||
    typeof pool?.query !== 'function' ||
    typeof supabase?.auth?.getUser !== 'function'
  ) {
    throw new TypeError('Injected trusted PostgreSQL pool and Auth required');
  }
  // The formal-release timestamp and synthetic proof anchor must never
  // coexist in one application configuration.
  if (stagingTestReferenceAt !== undefined && releaseTimestampIso !== undefined)
    throw new TypeError(
      'Formal release and synthetic Staging dates must not mix'
    );
  // A single synthetic-reader Staging proof cannot activate any reward path.
  if (
    stagingTestReferenceAt !== undefined &&
    (releaseConfiguration?.formalRewardsEnabled === true ||
      releaseConfiguration?.formalEarningsEnabled === true ||
      releaseConfiguration?.productionCutoverApproved === true)
  )
    throw new TypeError('Staging synthetic proof must keep rewards disabled');
  // New post-release readers are independent from unresolved beta histories.
  // The registration/write gate remains OFF until explicit Staging approval.
  const newReader = createUnregisteredFormalNewReaderOnboarding({
    pool,
    // Never use the synthetic Staging test timestamp as the formal release.
    releaseAt:
      stagingTestReferenceAt === undefined ? releaseTimestampIso : undefined,
    stagingTestReferenceAt,
    now,
    stagingRef,
    releaseConfiguration,
    trustedServerAuthorization
  });
  const earningSourceReader = createFormalCanonicalSourceReader({
    postgresClient: pool
  });
  // Read Level from scout_level_state and XP ledger; reconcile wallet to the
  // existing canonical Point ledger. No second source of truth is introduced.
  const usage = createUnregisteredFormalPostgresRewardHost({
    initializeNewReader: newReader.initializeOne,
    inspectNewReader:
      stagingTestReferenceAt !== undefined
        ? newReader.inspectVerifiedOne
        : (user) => newReader.inspectOne(user.id),
    inspectEarningSource: earningSourceReader.load,
    // A single verified Auth user cannot prove cohort totals.
    getNewReaderSummary:
      stagingTestReferenceAt === undefined
        ? newReader.getAdminSummary
        : undefined,
    pool,
    supabase,
    unitVerification,
    now,
    releaseConfiguration,
    trustedServerAuthorization,
    env,
    catalog,
    policy,
    aiExecutor,
    verifyGiftReceipt,
    verifyGiftNonFulfillment,
    verifyGiftRefund,
    verifyAiRefund
  });
  // Formal read/comment earnings reuse the already implemented durable runner.
  // Its own launch gates remain disabled unless a future trusted host approves.
  const earnings =
    stagingTestReferenceAt !== undefined
      ? Object.freeze({
          submitModeration: async () => ({ status: 'formal_worker_disabled' }),
          drainDue: async () => ({ status: 'formal_worker_disabled' }),
          bindExistingScheduler: () => {
            throw new Error('EARNING_WORKER_UNAVAILABLE_IN_STAGING_PROOF');
          }
        })
      : createFormalEarningRunner({
          postgresClient: pool,
          releaseTimestampIso,
          launchConfiguration: releaseConfiguration,
          trustedServerAuthorization,
          verifyModeratorReceipt
        });

  const opening =
    stagingTestReferenceAt !== undefined
      ? Object.freeze({
          inspect: async () => ({
            status: 'beta_opening_unavailable_in_staging_proof'
          }),
          inspectCohort: async () => ({
            status: 'beta_opening_unavailable_in_staging_proof'
          }),
          initializeOne: async () => ({
            status: 'beta_opening_unavailable_in_staging_proof'
          })
        })
      : createUnregisteredFormalOpeningSync({
          pool,
          releaseAt: releaseTimestampIso,
          unitVerification,
          stagingRef
        });

  return Object.freeze({
    // Explicitly unregistered: an approved host must mount these later.
    readerHttp: usage.handlers.reader,
    adminHttp: usage.handlers.admin,
    createApiDispatch: ({ readerPath, adminPath } = {}) =>
      createUnregisteredFormalApiDispatch({
        application: {
          readerHttp: usage.handlers.reader,
          adminHttp: usage.handlers.admin
        },
        readerPath,
        adminPath
      }),
    inspectFormalOpening: opening.inspect,
    inspectFormalOpeningCohort: opening.inspectCohort,
    initializeFormalOpening: opening.initializeOne,
    inspectNewReader:
      stagingTestReferenceAt !== undefined
        ? newReader.inspectVerifiedOne
        : newReader.inspectOne,
    getNewReaderSummary:
      stagingTestReferenceAt === undefined
        ? newReader.getAdminSummary
        : undefined,
    initializeNewReader: newReader.initializeOne,
    inspectNewReader:
      stagingTestReferenceAt !== undefined
        ? newReader.inspectVerifiedOne
        : newReader.inspectOne,
    inspectEarningSource: earningSourceReader.load,
    getReaderSnapshot: usage.service.getReaderSnapshot,
    submitModeration: earnings.submitModeration,
    drainDueEarnings: earnings.drainDue,
    bindExistingScheduler: earnings.bindExistingScheduler
  });
}
