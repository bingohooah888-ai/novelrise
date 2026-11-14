// Gate 02: isolated, read-only Scout XP maintenance review planning.
// No DB connection, schedule, write, payout or public API wiring.
import {
  SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS,
  quoteScoutProgressAfterMaintenanceReview
} from './rates.js';

const PERIOD_MS = SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS * 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function safeMs(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      'Expected a nonnegative safe UTC millisecond timestamp'
    );
  }
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError('Expected a server-verified UUID');
  }
  return value.toLowerCase();
}

/** Exact, disjoint 30-day windows, numbered from the authorized first anchor. */
export function quoteScoutMaintenanceWindow({
  firstWindowStartMs,
  reviewOrdinal
}) {
  safeMs(firstWindowStartMs);
  if (!Number.isSafeInteger(reviewOrdinal) || reviewOrdinal < 1) {
    throw new RangeError('Review ordinal must be a positive safe integer');
  }
  const windowStartMs = firstWindowStartMs + (reviewOrdinal - 1) * PERIOD_MS;
  const windowEndMs = windowStartMs + PERIOD_MS;
  safeMs(windowStartMs);
  safeMs(windowEndMs);
  return Object.freeze({ reviewOrdinal, windowStartMs, windowEndMs });
}

/**
 * Input is a complete trusted server query of scout_xp_ledger, scoped to ONE
 * user. A boolean completeness assertion is not independent proof: the future
 * authorized backend must enforce full-window completeness and identity.
 * Signed adjustments have undecided attribution rules and block a quotation.
 */
function summarizeXpRows(rows, userId, start, end) {
  if (!Array.isArray(rows))
    throw new TypeError('XP ledger rows must be an array');
  let earnedXp = 0;
  let adjusted = false;
  let count = 0;
  const ids = new Set();
  const uniqueSources = new Set();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('Malformed XP ledger row');
    }
    const rowId = uuid(row.id);
    const source = uuid(row.source_event_id);
    if (uuid(row.user_id) !== userId) {
      throw new RangeError('Mixed-user XP ledger snapshot');
    }
    const kind = row.xp_kind;
    if (typeof kind !== 'string' || kind.length < 1 || kind.length > 80) {
      throw new TypeError('XP kind violates existing DB constraint');
    }
    if (
      !Number.isSafeInteger(row.xp_value) ||
      Math.abs(row.xp_value) > 1000000
    ) {
      throw new RangeError('XP delta violates existing DB constraint');
    }
    if (typeof row.occurred_at !== 'string' || !INSTANT.test(row.occurred_at)) {
      throw new TypeError('XP timestamp must include a UTC offset');
    }
    const occurredAtMs = Date.parse(row.occurred_at);
    safeMs(occurredAtMs);
    if (occurredAtMs < start || occurredAtMs >= end) continue;
    const uniqueSource = source + ':' + kind;
    if (ids.has(rowId) || uniqueSources.has(uniqueSource)) {
      throw new RangeError('Duplicate ledger event in review snapshot');
    }
    ids.add(rowId);
    uniqueSources.add(uniqueSource);
    count++;
    if (row.xp_value < 0) {
      adjusted = true;
    } else {
      earnedXp += row.xp_value;
      if (!Number.isSafeInteger(earnedXp))
        throw new RangeError('XP sum overflow');
    }
  }
  return { earnedXp, adjusted, count };
}

/**
 * Quote ONE closed window. This never authorizes or applies a demotion.
 * The stable review key is suitable for a future transactional unique claim.
 * Previously reviewed windows, missed checkpoints, corrections or incomplete
 * evidence are fail-closed: no demotion outcome is produced.
 */
export function quoteScoutMaintenanceReviewDryRun({
  accountId,
  firstWindowStartMs,
  reviewOrdinal,
  asOfMs,
  lastReviewedWindowEndMs = null,
  ledgerSnapshotComplete,
  verifiedLedgerRows,
  currentLevel,
  verifiedHistoricalMaxLevel,
  currentLevelProgressXp
}) {
  const userId = uuid(accountId);
  safeMs(asOfMs);
  const window = quoteScoutMaintenanceWindow({
    firstWindowStartMs,
    reviewOrdinal
  });
  if (lastReviewedWindowEndMs !== null) safeMs(lastReviewedWindowEndMs);
  const reviewKey = 'scout-maintenance-v1:' + userId + ':' + window.windowEndMs;
  const context = { ...window, reviewKey };

  if (
    lastReviewedWindowEndMs !== null &&
    lastReviewedWindowEndMs >= window.windowEndMs
  ) {
    return Object.freeze({ status: 'already_reviewed', ...context });
  }
  if (
    (reviewOrdinal === 1 && lastReviewedWindowEndMs !== null) ||
    (reviewOrdinal > 1 && lastReviewedWindowEndMs !== window.windowStartMs)
  ) {
    return Object.freeze({ status: 'checkpoint_mismatch', ...context });
  }
  if (asOfMs < window.windowEndMs) {
    return Object.freeze({ status: 'not_due', ...context });
  }
  if (ledgerSnapshotComplete !== true) {
    return Object.freeze({ status: 'evidence_incomplete', ...context });
  }

  const ledger = summarizeXpRows(
    verifiedLedgerRows,
    userId,
    window.windowStartMs,
    window.windowEndMs
  );
  if (ledger.adjusted) {
    return Object.freeze({ status: 'xp_adjustment_review', ...context });
  }
  const preview = quoteScoutProgressAfterMaintenanceReview({
    currentLevel,
    verifiedHistoricalMaxLevel,
    earnedXpInCompleted30DayWindow: ledger.earnedXp,
    currentLevelProgressXp
  });
  return Object.freeze({
    status: 'quotation_only',
    ...context,
    earnedXpInCompleted30DayWindow: ledger.earnedXp,
    ledgerRowsInWindow: ledger.count,
    quotedFromLevel: currentLevel,
    quotedFromHighestLevel: verifiedHistoricalMaxLevel,
    quotedFromLevelProgressXp: currentLevelProgressXp,
    ...preview
  });
}
