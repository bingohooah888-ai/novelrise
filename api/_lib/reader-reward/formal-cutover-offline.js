// OFFLINE-ONLY beta Point unit handoff and formal Level initialization.
// No DB calls, release flag writes, migrations, payouts or user-facing API.
// Input is a complete synthetic/trusted-source fixture for review; flags and
// calculations here NEVER attest that the real source ledger was exhaustive.
import {
  SCOUT_POINT_LEGACY_VERSION,
  SCOUT_POINT_TARGET_VERSION,
  SCOUT_POINT_UNIT_SCALE,
  quoteScoutPointTenfoldValue
} from './beta-point-tenfold-plan.js';
import { quoteApprovedScoutBetaFormalState } from './formal-thresholds.js';

export const SCOUT_MIXED_BETA_POINT_UNITS = 'beta_mixed_explicit_row_units';
const MAX_LEDGER_POINT_VALUE = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const safe = (v) => Number.isSafeInteger(v) && v >= 0;
const validId = (v) => typeof v === 'string' && UUID.test(v);
const unique = (xs) => new Set(xs).size === xs.length;
const hold = (code, extra = {}) =>
  Object.freeze({
    status: code,
    readyForOfflinePreview: false,
    ...extra,
    mayMigrateDb: false,
    mayIssuePoints: false,
    mayRedeem: false
  });

/**
 * Convert every confirmed, account-scoped beta Point entry exactly once and
 * quote a formal wallet with eligible=0. Users cannot exchange old beta Point,
 * although a separate approved AI allocation policy may consume them.
 *
 * We do not fabricate first-time issuance, rewrite event keys, grant badges
 * or convert XP. Suspicious/incomplete/negative states fail closed.
 */
export function quoteScoutOfflineBetaHandoff({
  ledgerUnitVersion,
  canonicalLedgerRows,
  accounts,
  betaThresholdRows,
  formalReleaseAtMs
} = {}) {
  const mixed = ledgerUnitVersion === SCOUT_MIXED_BETA_POINT_UNITS;
  if (ledgerUnitVersion !== SCOUT_POINT_LEGACY_VERSION && !mixed)
    return hold('legacy_point_unit_not_verified');
  if (
    !Array.isArray(canonicalLedgerRows) ||
    !Array.isArray(accounts) ||
    !safe(formalReleaseAtMs) ||
    !Array.isArray(betaThresholdRows)
  )
    return hold('offline_source_incomplete');
  const ids = new Set();
  const keys = new Set();
  const byId = new Map();
  const convertedById = new Map();
  const users = new Map();
  const convertedRows = [];
  for (const account of accounts) {
    if (
      !isRecord(account) ||
      !validId(account.userId) ||
      users.has(account.userId) ||
      !safe(account.accountCreatedAtMs) ||
      account.accountCreatedAtMs >= formalReleaseAtMs ||
      !safe(account.verifiedBetaLedgerXp) ||
      !isRecord(account.betaSummary)
    )
      return hold('account_cohort_or_xp_unverified');
    if (account.betaSummary.total_xp !== account.verifiedBetaLedgerXp)
      return hold('beta_xp_summary_ledger_mismatch');
    const level = quoteApprovedScoutBetaFormalState({
      userId: account.userId,
      authenticatedBetaSummary: account.betaSummary,
      betaThresholdRows,
      formalReleaseAtMs,
      accountCreatedAtMs: account.accountCreatedAtMs
    });
    if (level.status !== 'formal_state_quote_only') return hold(level.status);
    users.set(account.userId, {
      userId: account.userId,
      openingLegacyPoints: 0,
      openingAlreadyTenfoldPoints: 0,
      availablePoints: 0,
      exchangeEligiblePoints: 0,
      reservedPoints: 0,
      heldPoints: 0,
      revision: 0,
      formalState: level.state,
      firstMaintenanceReviewDueAtMs: level.firstReviewDueAtMs
    });
  }
  for (const row of canonicalLedgerRows) {
    if (
      !isRecord(row) ||
      !validId(row.id) ||
      !validId(row.user_id) ||
      !users.has(row.user_id) ||
      typeof row.event_key !== 'string' ||
      row.event_key.length < 1 ||
      row.event_key.length > 240 ||
      ids.has(row.id) ||
      keys.has(row.event_key) ||
      !Number.isSafeInteger(row.point_value) ||
      typeof row.point_kind !== 'string' ||
      !row.point_kind ||
      (mixed
        ? ![
            SCOUT_POINT_LEGACY_VERSION,
            SCOUT_POINT_TARGET_VERSION
          ].includes(row.sourceUnitVersion)
        : row.sourceUnitVersion !== undefined &&
          row.sourceUnitVersion !== SCOUT_POINT_LEGACY_VERSION)
    )
      return hold('legacy_ledger_identity_or_version_invalid');
    ids.add(row.id);
    keys.add(row.event_key);
    byId.set(row.id, row);
    if (row.status !== 'confirmed')
      return hold('nonconfirmed_legacy_point_requires_review');
    // 2026-11-09 changed future awards to 10 Point/yen but did not
    // retroactively convert earlier ledger rows. Never infer an individual
    // row's unit from its amount, timestamp, badge ID or event key.
    const unit = mixed ? row.sourceUnitVersion : SCOUT_POINT_LEGACY_VERSION;
    let convertedValue;
    if (unit === SCOUT_POINT_LEGACY_VERSION) {
      const quoted = quoteScoutPointTenfoldValue({
        legacyValue: row.point_value,
        sourceVersion: unit
      });
      if (quoted.status !== 'tenfold_value_quote_only')
        return hold('legacy_ledger_point_overflow');
      convertedValue = quoted.proposedValue;
    } else {
      if (Math.abs(row.point_value) > MAX_LEDGER_POINT_VALUE)
        return hold('already_tenfold_ledger_point_overflow');
      convertedValue = row.point_value;
    }
    const converted = Object.freeze({
      id: row.id,
      userId: row.user_id,
      eventKey: row.event_key,
      pointKind: row.point_kind,
      sourceValue: row.point_value,
      sourceUnitVersion: unit,
      convertedValue,
      reversalOf: row.reversal_of ?? null,
      status: 'confirmed'
    });
    convertedRows.push(converted);
    convertedById.set(row.id, converted);
  }
  const reversalTotals = new Map();
  for (const row of convertedRows) {
    if (row.reversalOf !== null) {
      const source = byId.get(row.reversalOf);
      if (
        !validId(row.reversalOf) ||
        !source ||
        source.user_id !== row.userId ||
        source.point_value <= 0 ||
        row.sourceValue >= 0 ||
        row.id === row.reversalOf
      )
        return hold('unverified_legacy_reversal');
      // The original and reversal can have different source units.
      // Compare only their final tenfold values and reject over-reversal.
      const total =
        (reversalTotals.get(row.reversalOf) ?? 0) - row.convertedValue;
      const original = convertedById.get(row.reversalOf);
      if (!Number.isSafeInteger(total) || total > original.convertedValue)
        return hold('legacy_reversal_exceeds_original');
      reversalTotals.set(row.reversalOf, total);
    } else if (row.sourceValue < 0) {
      return hold('legacy_negative_adjustment_policy_pending');
    }
    const account = users.get(row.userId);
    const oldTotal =
      account.openingLegacyPoints +
      (row.sourceUnitVersion === SCOUT_POINT_LEGACY_VERSION
        ? row.sourceValue
        : 0);
    const alreadyTenfold =
      account.openingAlreadyTenfoldPoints +
      (row.sourceUnitVersion === SCOUT_POINT_TARGET_VERSION
        ? row.sourceValue
        : 0);
    const nextTotal = account.availablePoints + row.convertedValue;
    if (
      !Number.isSafeInteger(oldTotal) ||
      !Number.isSafeInteger(alreadyTenfold) ||
      !Number.isSafeInteger(nextTotal)
    )
      return hold('legacy_user_sum_overflow');
    account.openingLegacyPoints = oldTotal;
    account.openingAlreadyTenfoldPoints = alreadyTenfold;
    account.availablePoints = nextTotal;
  }
  const walletSeeds = [];
  for (const account of users.values()) {
    if (account.availablePoints < 0 || account.openingLegacyPoints < 0)
      return hold('legacy_point_debt_requires_review');
    if (
      account.availablePoints !==
      account.openingLegacyPoints * SCOUT_POINT_UNIT_SCALE +
        account.openingAlreadyTenfoldPoints
    )
      return hold('tenfold_reconciliation_mismatch');
    walletSeeds.push(Object.freeze({ ...account }));
  }
  const originalNet = walletSeeds.reduce(
    (sum, s) => sum + s.openingLegacyPoints,
    0
  );
  const preservedNet = walletSeeds.reduce(
    (sum, s) => sum + s.openingAlreadyTenfoldPoints,
    0
  );
  const convertedNet = walletSeeds.reduce(
    (sum, s) => sum + s.availablePoints,
    0
  );
  if (
    !Number.isSafeInteger(originalNet) ||
    !Number.isSafeInteger(preservedNet) ||
    !Number.isSafeInteger(convertedNet) ||
    convertedNet !== originalNet * SCOUT_POINT_UNIT_SCALE + preservedNet
  )
    return hold('all_user_ledger_sum_overflow');
  return Object.freeze({
    status: 'offline_handoff_quote_only',
    readyForOfflinePreview: true,
    sourceVersion: ledgerUnitVersion,
    targetVersion: SCOUT_POINT_TARGET_VERSION,
    convertedRows: Object.freeze(convertedRows),
    walletSeeds: Object.freeze(walletSeeds),
    summary: Object.freeze({
      accountCount: walletSeeds.length,
      ledgerRowCount: convertedRows.length,
      originalConfirmedNet: mixed ? null : originalNet,
      legacyOriginalConfirmedNet: originalNet,
      alreadyTenfoldConfirmedNet: preservedNet,
      legacyRowsConverted: convertedRows.filter(
        (row) => row.sourceUnitVersion === SCOUT_POINT_LEGACY_VERSION
      ).length,
      alreadyTenfoldRowsPreserved: convertedRows.filter(
        (row) => row.sourceUnitVersion === SCOUT_POINT_TARGET_VERSION
      ).length,
      convertedConfirmedNet: convertedNet
    }),
    schemaWasChanged: false,
    cutoverWasExecuted: false,
    liveEvidenceVerified: false,
    mayMigrateDb: false,
    mayIssuePoints: false,
    mayRedeem: false
  });
}

/**
 * Reconcile the fully converted canonical entries against proposed wallet
 * seeds. This is useful for local fixtures, NOT a live migration certificate.
 */
export function reconcileScoutOfflineOpening({
  handoff,
  convertedLedgerRows
} = {}) {
  if (
    handoff?.status !== 'offline_handoff_quote_only' ||
    !Array.isArray(convertedLedgerRows)
  )
    return hold('opening_quote_missing');
  const baseline = new Map(handoff.convertedRows.map((r) => [r.id, r]));
  if (
    !unique(convertedLedgerRows.map((r) => r.id)) ||
    baseline.size !== convertedLedgerRows.length
  )
    return hold('opening_ledger_count_or_identity_mismatch');
  const sums = new Map();
  for (const row of convertedLedgerRows) {
    const b = baseline.get(row?.id);
    if (
      !b ||
      b.userId !== row.userId ||
      b.eventKey !== row.eventKey ||
      b.status !== row.status ||
      b.pointKind !== row.pointKind ||
      b.sourceValue !== row.sourceValue ||
      b.sourceUnitVersion !== row.sourceUnitVersion ||
      b.reversalOf !== row.reversalOf ||
      b.convertedValue !== row.convertedValue
    )
      return hold('opening_ledger_value_mismatch');
    const next = (sums.get(row.userId) ?? 0) + row.convertedValue;
    if (!Number.isSafeInteger(next)) return hold('opening_ledger_sum_overflow');
    sums.set(row.userId, next);
  }
  for (const seed of handoff.walletSeeds) {
    if (
      (sums.get(seed.userId) ?? 0) !== seed.availablePoints ||
      seed.exchangeEligiblePoints !== 0 ||
      seed.reservedPoints !== 0
    )
      return hold('opening_wallet_canonical_mismatch');
  }
  return Object.freeze({
    status: 'offline_opening_reconciled',
    reconciledUsers: handoff.walletSeeds.length,
    reconciledRows: handoff.convertedRows.length,
    realDbChecked: false,
    mayMigrateDb: false,
    mayIssuePoints: false
  });
}
