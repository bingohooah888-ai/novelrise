// Draft-only: this module cannot modify Scout levels, award money or schedule reviews.
// Metrics must be independently verified on the server before being passed here.
// A numeric count alone does NOT establish verified activity or a right to demote.

export const SCOUT_DEMOTION_ACTIVITY_METRICS = Object.freeze([
  'validReadCount',
  'verifiedDiscoverySuccessCount'
]);

/**
 * Preserve both OWNER-approved evidence channels for an eligible 30-day review.
 * The valid-read unit (episode/work), thresholds, AND/OR policy and downgrade
 * magnitude are not decided. This helper intentionally returns NO decision.
 */
export function buildScoutDemotionActivityEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('A server-verified Scout activity snapshot is required');
  }
  const { validReadCount, verifiedDiscoverySuccessCount } = input;
  for (const value of [validReadCount, verifiedDiscoverySuccessCount]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        'Both valid read and verified discovery counts must be nonnegative safe integers'
      );
    }
  }
  return Object.freeze({
    validReadCount,
    verifiedDiscoverySuccessCount
  });
}
