// Draft-only formal SCOUT 30-day safety contract. No runtime unlock.
//
// A real seal, late-XP compensation policy, full XP-writer serialization,
// beta-to-formal cutover, and least-privilege due RPC are NOT approved.
// Do not replace this with booleans supplied by a caller or an offline test.
export const FORMAL_MAINTENANCE_SAFETY_APPROVED = false;

export const FORMAL_MAINTENANCE_PENDING_PROOFS = Object.freeze([
  'allXpInsertUpdateDeleteWritersSerialized',
  'triggerAndCrossUserLockOrderAudited',
  'trustedIngestionWindowSealEnforced',
  'delayedAndUncommittedXpReconciled',
  'durableLateXpCorrectionHoldingImplemented',
  'postReviewRestorationPolicyApproved',
  'betaCapCutoverApprovedAndVerified',
  'discoveryXpSourceReconciled',
  'backfillAndRollbackVerified',
  'privateDueUserRpcPrivilegeVerified',
  'separateOwnerReleaseApproval'
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PROPOSED_SCOUT_LOCK_PREFIX =
  'novelight:scout-formal-xp-review:v1:';

// Quotation only: no database lock is acquired by this function.
export function quoteScoutXpLockOrder(userIds) {
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 25) {
    throw new RangeError('One to 25 server-verified UUIDs required');
  }
  const ids = new Set();
  for (const id of userIds) {
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new TypeError('Unverified UUID');
    }
    ids.add(id.toLowerCase());
  }
  return Object.freeze(
    [...ids].sort().map((id) => PROPOSED_SCOUT_LOCK_PREFIX + id)
  );
}

// Evidence flags are a design checklist, never authorization to call an RPC.
// Even all true does not prove source finality or an approved release.
export function inspectFormalMaintenanceDesignEvidence(evidence = {}) {
  const valid =
    evidence !== null &&
    typeof evidence === 'object' &&
    !Array.isArray(evidence);
  const missing = FORMAL_MAINTENANCE_PENDING_PROOFS.filter(
    (key) => !valid || evidence[key] !== true
  );
  return Object.freeze({
    status:
      missing.length === 0
        ? 'requires_separate_database_proof_and_owner_approval'
        : 'formal_maintenance_safety_unverified',
    executionAllowed: false,
    missing: Object.freeze(missing)
  });
}
