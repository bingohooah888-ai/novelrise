// Formal rewards host composition. This module is NOT an API route.
// It does not create DB connections, activate flags or load secrets.
// Application release wiring must remain absent until a dedicated approval.
import { createFormalRewardUsageService } from './formal-usage-service.js';
import { createFormalUsageHttpHandlers } from './formal-usage-http.js';
import { createFormalUsagePostgresRepository } from './formal-usage-postgres-repository.js';

export function createUnregisteredFormalRewardHost({
  repository,
  supabase,
  releaseConfiguration,
  trustedServerAuthorization,
  catalog,
  policy,
  aiExecutor,
  verifyGiftReceipt,
  verifyGiftNonFulfillment,
  env
} = {}) {
  const service = createFormalRewardUsageService({
    repository,
    releaseConfiguration,
    trustedServerAuthorization,
    catalog,
    policy,
    aiExecutor,
    verifyGiftReceipt,
    verifyGiftNonFulfillment
  });
  const handlers = createFormalUsageHttpHandlers({
    service,
    supabase,
    env
  });
  return Object.freeze({ service, handlers });
}

export function createUnregisteredFormalPostgresRewardHost({
  pool,
  readFormalAccount,
  readCanonicalPointHistory,
  ...host
} = {}) {
  const repository = createFormalUsagePostgresRepository({
    pool,
    readFormalAccount,
    readCanonicalPointHistory
  });
  return createUnregisteredFormalRewardHost({ ...host, repository });
}
