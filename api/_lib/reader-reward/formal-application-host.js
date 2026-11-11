// Formal release application composition. Not a Vercel API route.
// Uses the existing canonical XP/Point readers, transactional usage service,
// authenticated HTTP handlers, and approved earning worker without starting them.
// This module creates no connection, migration, job, endpoint, or feature flag.
import { createUnregisteredFormalPostgresRewardHost } from './formal-usage-host.js';
import { createFormalEarningRunner } from './formal-earning-runner.js';
import { createUnregisteredFormalOpeningSync } from './formal-opening-sync.js';
import { createUnregisteredFormalApiDispatch } from './formal-api-dispatch.js';

export function createUnregisteredFormalApplication({
  pool,
  supabase,
  unitVerification,
  now,
  releaseConfiguration,
  trustedServerAuthorization,
  releaseTimestampIso,
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
  // Read Level from scout_level_state and XP ledger; reconcile wallet to the
  // existing canonical Point ledger. No second source of truth is introduced.
  const usage = createUnregisteredFormalPostgresRewardHost({
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
  const earnings = createFormalEarningRunner({
    postgresClient: pool,
    releaseTimestampIso,
    launchConfiguration: releaseConfiguration,
    trustedServerAuthorization,
    verifyModeratorReceipt
  });

  const opening = createUnregisteredFormalOpeningSync({
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
    initializeFormalOpening: opening.initializeOne,
    getReaderSnapshot: usage.service.getReaderSnapshot,
    submitModeration: earnings.submitModeration,
    drainDueEarnings: earnings.drainDue,
    bindExistingScheduler: earnings.bindExistingScheduler
  });
}
