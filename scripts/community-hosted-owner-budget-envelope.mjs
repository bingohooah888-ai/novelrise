// OWNER-authored cost envelope: structure only, NOT an executable grant.
// A timebox is not a provider-enforced billing ceiling.
const FIELDS = [
  'acknowledgement',
  'cleanupGraceMinutes',
  'currency',
  'maxMinutes',
  'maxTotalMinor',
  'strategy',
  'supabaseMaxMinor',
  'vercelMaxMinor',
  'watchdogIntervalMinutes'
].sort().join(',');

function deny() {
  throw new Error('COMMUNITY_HOSTED_OWNER_BUDGET_ENVELOPE_DENIED');
}

export function inspectCommunityHostedOwnerBudgetEnvelope(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== FIELDS ||
    value.acknowledgement !== 'TIMEBOX IS NOT A PROVIDER BILLING HARD STOP' ||
    value.strategy !== 'timeboxed-independent-cleanup-v1' ||
    value.currency !== 'JPY' ||
    !Number.isSafeInteger(value.maxTotalMinor) ||
    value.maxTotalMinor <= 0 ||
    !Number.isSafeInteger(value.supabaseMaxMinor) ||
    value.supabaseMaxMinor <= 0 ||
    !Number.isSafeInteger(value.vercelMaxMinor) ||
    value.vercelMaxMinor <= 0 ||
    value.supabaseMaxMinor > value.maxTotalMinor ||
    value.vercelMaxMinor > value.maxTotalMinor - value.supabaseMaxMinor ||
    !Number.isSafeInteger(value.maxMinutes) ||
    value.maxMinutes < 1 ||
    value.maxMinutes > 120 ||
    !Number.isSafeInteger(value.watchdogIntervalMinutes) ||
    value.watchdogIntervalMinutes < 1 ||
    value.watchdogIntervalMinutes > 5 ||
    !Number.isSafeInteger(value.cleanupGraceMinutes) ||
    value.cleanupGraceMinutes < 1 ||
    value.cleanupGraceMinutes > 15
  ) deny();
  return Object.freeze({
    status: 'OWNER_BUDGET_STRUCTURE_ONLY',
    currency: value.currency,
    maxTotalMinor: value.maxTotalMinor,
    supabaseMaxMinor: value.supabaseMaxMinor,
    vercelMaxMinor: value.vercelMaxMinor,
    maxMinutes: value.maxMinutes,
    cleanupGraceMinutes: value.cleanupGraceMinutes,
    authenticatedLiveBill: false,
    providerHardStopVerified: false,
    independentWatchdogLiveVerified: false,
    stagingCostApproved: false,
    mayClaim: false,
    mayCreateBranch: false,
    runAuthorized: false,
    releaseAuthorized: false
  });
}
