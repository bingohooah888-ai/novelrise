// Formal rewards host composition. This module is NOT an API route.
// It does not create DB connections, activate flags or load secrets.
// Application release wiring must remain absent until a dedicated approval.
import { createFormalRewardUsageService } from './formal-usage-service.js';
import { createFormalUsageHttpHandlers } from './formal-usage-http.js';
import { createFormalUsagePostgresRepository } from './formal-usage-postgres-repository.js';
import { createFormalCanonicalReader } from './formal-canonical-reader.js';

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
  verifyGiftRefund,
  verifyAiRefund,
  env,
  initializeNewReader,
  getNewReaderSummary
} = {}) {
  const service = createFormalRewardUsageService({
    repository,
    releaseConfiguration,
    trustedServerAuthorization,
    catalog,
    policy,
    aiExecutor,
    verifyGiftReceipt,
    verifyGiftNonFulfillment,
    verifyGiftRefund,
    verifyAiRefund
  });
  const handlers = createFormalUsageHttpHandlers({
    service,
    supabase,
    env,
    initializeNewReader,
    getNewReaderSummary
  });
  return Object.freeze({ service, handlers });
}

export function createUnregisteredFormalPostgresRewardHost({
  pool,
  readFormalAccount,
  readCanonicalPointHistory,
  unitVerification,
  now,
  ...host
} = {}) {
  if (typeof pool?.query !== 'function')
    throw new TypeError('Trusted PostgreSQL query executor required');
  const canonicalReader = createFormalCanonicalReader({
    query: pool.query.bind(pool),
    unitVerification,
    now
  });
  const repository = createFormalUsagePostgresRepository({
    pool,
    canonicalReader,
    readFormalAccount: readFormalAccount || canonicalReader.readFormalAccount,
    readCanonicalPointHistory:
      readCanonicalPointHistory || canonicalReader.readCanonicalPointHistory
  });
  return createUnregisteredFormalRewardHost({ ...host, repository });
}
