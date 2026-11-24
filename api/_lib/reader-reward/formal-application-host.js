// Formal release application composition. Not a Vercel API route.
// Uses the existing canonical XP/Point readers, transactional usage service,
// authenticated HTTP handlers, and approved earning worker without starting them.
// This module creates no connection, migration, job, endpoint, or feature flag.
import { createUnregisteredFormalPostgresRewardHost } from './formal-usage-host.js';
import { createFormalEarningRunner } from './formal-earning-runner.js';
import { createUnregisteredFormalMaintenanceRunner } from './formal-maintenance-runner.js';
import { createUnregisteredFormalOpeningSync } from './formal-opening-sync.js';
import { createUnregisteredFormalNewReaderOnboarding } from './formal-new-reader-onboarding.js';
import { createUnregisteredFormalApiDispatch } from './formal-api-dispatch.js';
import { createFormalCanonicalSourceReader } from './formal-earning-source-reader.js';
import { holdDeferredFormalChannels } from './formal-deferred-channel-gates.js';
import { createUnregisteredFormalBadgeCatalogInspector } from './formal-badge-catalog-inspector.js';
import { createUnregisteredFormalBadgeHistoryInspector } from './formal-badge-history-inspector.js';
import { createUnregisteredFormalWalletCohortInspector } from './formal-wallet-cohort-inspector.js';
import { createUnregisteredFormalSettlementRecoveryInspector } from './formal-settlement-recovery-inspector.js';

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

  // The Staging RO role is RLS-scoped to one verified Auth identity. A global
  // registration cohort is not observable through this role and must never
  // be inferred from a single account. This report is admin-only, self-only.
  const stagingAdminSummary =
    stagingTestReferenceAt === undefined
      ? newReader.getAdminSummary
      : async (verifiedAdmin) => {
          const report = await newReader.inspectVerifiedOne(verifiedAdmin);
          return Object.freeze({
            status: 'staging_verified_admin_reader_only',
            scope: 'verified_admin_self_only',
            readerStatus: report.status,
            counts: report.counts ?? null,
            totalRegistered: null,
            initialized: null,
            partial: null,
            referenceAt: stagingTestReferenceAt,
            referenceMode: 'staging_synthetic_one_reader_proof',
            readyForPublicRelease: false,
            legacyPointMigrationUnaffected: true
          });
        };

  const earningSourceReader = createFormalCanonicalSourceReader({
    postgresClient: pool
  });
  const badgeCatalog = createUnregisteredFormalBadgeCatalogInspector({
    query: pool.query.bind(pool)
  });
  const badgeHistory = createUnregisteredFormalBadgeHistoryInspector({
    query: pool.query.bind(pool)
  });
  const walletCohort = createUnregisteredFormalWalletCohortInspector({
    query: pool.query.bind(pool)
  });
  const settlementRecovery =
    createUnregisteredFormalSettlementRecoveryInspector({
      query: pool.query.bind(pool)
    });
  // OWNER-held channels remain independently OFF even if formal earning,
  // Level, or wallet readiness is later approved. No supplied catalog or
  // provider adapter can activate gift exchange or charge for AI by accident.
  const deferred = holdDeferredFormalChannels({ catalog, policy });
  // Formal read/comment earnings reuse the already implemented durable runner.
  // Its own launch gates remain disabled unless a future trusted host approves.
  const earnings =
    stagingTestReferenceAt !== undefined
      ? Object.freeze({
          enqueueCommittedEvent: async () => ({
            status: 'formal_worker_disabled'
          }),
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

  // Do not allow the single-reader Staging proof to bind a maintenance writer.
  // Normal formal mode is still disabled until two independent review flags
  // and the trusted-server cutover gate are approved by a future host.
  const maintenance =
    stagingTestReferenceAt !== undefined
      ? Object.freeze({
          inspectConnectionReadiness: async () => ({
            status: 'formal_maintenance_disabled'
          }),
          reviewDue: async () => ({ status: 'formal_maintenance_disabled' }),
          bindExistingScheduler: () => ({
            status: 'formal_maintenance_disabled'
          })
        })
      : createUnregisteredFormalMaintenanceRunner({
          postgresClient: pool,
          launchConfiguration: releaseConfiguration,
          trustedServerAuthorization
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
    getAdminBadgeCatalog: badgeCatalog.inspect,
    getAdminBadgeHistory: badgeHistory.inspect,
    getAdminWalletCohort: walletCohort.inspect,
    getAdminSettlementRecovery: settlementRecovery.inspect,
    getAdminMaintenanceReadiness: maintenance.inspectConnectionReadiness,
    // A single verified Auth user cannot prove cohort totals.
    getNewReaderSummary: stagingAdminSummary,
    pool,
    supabase,
    unitVerification,
    now,
    releaseConfiguration,
    trustedServerAuthorization,
    env,
    catalog: deferred.catalog,
    policy: deferred.policy,
    aiExecutor: deferred.aiExecutor,
    verifyGiftReceipt,
    verifyGiftNonFulfillment,
    verifyGiftRefund,
    verifyAiRefund
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
    getNewReaderSummary: stagingAdminSummary,
    initializeNewReader: newReader.initializeOne,
    inspectNewReader:
      stagingTestReferenceAt !== undefined
        ? newReader.inspectVerifiedOne
        : newReader.inspectOne,
    inspectEarningSource: earningSourceReader.load,
    inspectReaderBadgeCatalog: badgeCatalog.inspect,
    inspectReaderBadgeHistory: badgeHistory.inspect,
    inspectWalletCohort: walletCohort.inspect,
    inspectSettlementRecovery: settlementRecovery.inspect,
    getReaderSnapshot: usage.service.getReaderSnapshot,
    // Trusted future host may hand off a committed canonical event; no
    // public endpoint or runtime worker is registered by this composition.
    enqueueCommittedEarning: earnings.enqueueCommittedEvent,
    submitModeration: earnings.submitModeration,
    drainDueEarnings: earnings.drainDue,
    bindExistingScheduler: earnings.bindExistingScheduler,
    inspectMaintenanceConnectionReadiness:
      maintenance.inspectConnectionReadiness,
    reviewDueMaintenance: maintenance.reviewDue,
    bindExistingMaintenanceScheduler: maintenance.bindExistingScheduler
  });
}
