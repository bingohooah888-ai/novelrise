// Gate 05: read-only schema compatibility and beta-state handoff quotations.
// These helpers NEVER open a DB connection, create a migration, grant XP,
// update a reader, or authorize switching the production Scout RPC.
import { quoteScoutFirstDemotionReviewWindow } from './rates.js';

const REQUIRED_XP_COLS = Object.freeze([
  'id', 'user_id', 'source_event_id', 'xp_kind',
  'xp_value', 'rule_version', 'occurred_at'
]);
const REQUIRED_EVENT_COLS = Object.freeze([
  'id', 'user_id', 'event_type', 'event_key', 'occurred_at'
]);
const REQUIRED_THRESHOLD_COLS = Object.freeze([
  'level', 'cumulative_xp', 'rule_version'
]);
const BETA_TRIGGER_NAMES = Object.freeze([
  'scout_xp_beta_level_cap',
  'scout_xp_level_up_points'
]);
const REQUIRED_TRIGGERS = Object.freeze([
  'scout_xp_refresh_reader_badges',
  'scout_event_valid_read_xp'
]);
const LEGACY_RPCS = Object.freeze([
  'novelight_scout_record_summary',
  'novelight_scout_level_for_xp',
  'novelight_award_level_up_points',
  'novelight_cap_scout_xp_beta'
]);

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function hasColumns(t, cols) {
  return t && Array.isArray(t.columns) &&
    cols.every(c => t.columns.includes(c));
}
function assertedBoolean(v) {
  return v === true || v === false;
}
function safeInt(n, lo = 0, hi = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(n) && n >= lo && n <= hi;
}

/**
 * Input: trusted, read-only *metadata*, NOT user records. The caller must
 * obtain DB schema/RLS/index/trigger/function information independently.
 *
 * Output NEVER authorizes an automatic cutover. Active legacy functions or
 * beta triggers explicitly block wiring new progression to production.
 */
export function auditScoutDbCompatibility(metadata) {
  if (!isObject(metadata) || !isObject(metadata.tables) ||
      !Array.isArray(metadata.uniqueKeys) ||
      !Array.isArray(metadata.triggers) ||
      !Array.isArray(metadata.functions)) {
    throw new TypeError('Complete read-only database metadata is required');
  }
  const blockers = [];
  const t = metadata.tables;
  for (const [name, columns] of [
    ['scout_xp_ledger', REQUIRED_XP_COLS],
    ['scout_event_ledger', REQUIRED_EVENT_COLS],
    ['scout_level_thresholds', REQUIRED_THRESHOLD_COLS]
  ]) {
    if (!hasColumns(t[name], columns)) blockers.push('missing_existing_columns:' + name);
    if (!assertedBoolean(t[name]?.rlsEnabled) || !t[name].rlsEnabled) {
      blockers.push('rls_not_verified:' + name);
    }
  }
  const hasUnique = (tableName, columns) => metadata.uniqueKeys.some(u =>
    isObject(u) && u.tableName === tableName &&
    Array.isArray(u.columns) && u.columns.length === columns.length &&
    u.columns.every((v, i) => v === columns[i])
  );
  if (!hasUnique('scout_xp_ledger', ['user_id', 'source_event_id', 'xp_kind'])) {
    blockers.push('xp_source_uniqueness_not_verified');
  }
  if (!hasUnique('scout_event_ledger', ['event_key'])) {
    blockers.push('event_uniqueness_not_verified');
  }

  const triggerNames = new Set(metadata.triggers
    .filter(v => isObject(v) && typeof v.name === 'string')
    .map(v => v.tableName + ':' + v.name));
  for (const x of REQUIRED_TRIGGERS) {
    const table = x === 'scout_event_valid_read_xp'
      ? 'scout_event_ledger' : 'scout_xp_ledger';
    if (!triggerNames.has(table + ':' + x)) {
      blockers.push('beta_scaffold_trigger_missing:' + x);
    }
  }
  for (const name of BETA_TRIGGER_NAMES) {
    if (triggerNames.has('scout_xp_ledger:' + name)) {
      blockers.push('active_beta_trigger:' + name);
    }
  }
  const existingFns = new Set(metadata.functions);
  for (const name of LEGACY_RPCS) {
    if (!existingFns.has(name)) blockers.push('legacy_function_not_verified:' + name);
  }
  if (existingFns.has('novelight_scout_record_summary')) {
    blockers.push('legacy_summary_uses_cumulative_xp');
  }
  // The owner has not approved the exact future table names. Check
  // abstract evidence, never impose newly invented table names on a schema.
  if (!isObject(metadata.formalStateContract) ||
      metadata.formalStateContract.verified !== true ||
      metadata.formalStateContract.hasProgressAndPeak !== true ||
      metadata.formalStateContract.hasRevisionCas !== true) {
    blockers.push('formal_progress_state_not_verified');
  }
  if (!isObject(metadata.formalReviewClaimContract) ||
      metadata.formalReviewClaimContract.verified !== true ||
      metadata.formalReviewClaimContract.hasUserWindowUniqueKey !== true ||
      metadata.formalReviewClaimContract.sameTransactionAsState !== true) {
    blockers.push('formal_review_uniqueness_not_verified');
  }
  return Object.freeze({
    status: 'cutover_not_authorized',
    blockers: Object.freeze(blockers),
    preservesBeta: true,
    // No amount of optimistic metadata can substitute OWNER release approval,
    // an approved migration, transactional proof and live staging verification.
    productionCutoverAllowed: false
  });
}

/**
 * Verify the existing 30-row beta XP ladder without inventing Lv.31-100.
 * The beta cumulative table is neither a formal release progress state nor
 * a substitute for approved new thresholds.
 */
export function validateScoutBetaThresholds(rows) {
  if (!Array.isArray(rows) || rows.length !== 30) {
    throw new RangeError('Expected exactly the existing Lv.1-30 beta XP table');
  }
  let previous = -1;
  let ruleVersion = null;
  const result = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isObject(r) || r.level !== i + 1 ||
        !safeInt(r.cumulative_xp) ||
        r.cumulative_xp <= previous ||
        typeof r.rule_version !== 'string' || !r.rule_version) {
      throw new RangeError('Invalid beta XP ladder or missing stable rule version');
    }
    if (ruleVersion !== null && r.rule_version !== ruleVersion) {
      throw new RangeError('Mixed rule versions in beta XP ladder');
    }
    ruleVersion = r.rule_version;
    result[r.level] = r.cumulative_xp;
    previous = r.cumulative_xp;
  }
  if (result[1] !== 0 || result[30] !== 9570) {
    throw new RangeError('Beta threshold boundary mismatch');
  }
  return Object.freeze({ ruleVersion, cumulativeByLevel: Object.freeze(result) });
}

/**
 * Draft-only handoff from the authenticated beta RPC display summary.
 * This MUST be cross-checked against server-authoritative ledger/account
 * records in the future. Never convert raw_recorded_xp to "lifetime XP".
 */
export function quoteScoutBetaToFormalHandoff({
  authenticatedBetaSummary,
  betaThresholdRows,
  formalReleaseAtMs,
  accountCreatedAtMs
}) {
  if (!isObject(authenticatedBetaSummary)) {
    throw new TypeError('Authenticated beta summary candidate required');
  }
  const ladder = validateScoutBetaThresholds(betaThresholdRows);
  const beta = authenticatedBetaSummary;
  if (!safeInt(beta.level, 1, 30) || !safeInt(beta.total_xp, 0, 9570) ||
      !safeInt(beta.xp_into_level) ||
      !safeInt(beta.xp_for_next_level) ||
      typeof beta.beta_level_max !== 'boolean') {
    throw new TypeError('Malformed beta Scout record summary');
  }
  const calculatedLevel = Object.entries(ladder.cumulativeByLevel)
    .filter(([, x]) => x <= beta.total_xp)
    .reduce((p, [level]) => Number(level), 1);
  const expectedProgress = beta.total_xp - ladder.cumulativeByLevel[beta.level];
  const expectedNeeded = beta.level === 30 ? 0 :
    ladder.cumulativeByLevel[beta.level + 1] - ladder.cumulativeByLevel[beta.level];
  if (calculatedLevel !== beta.level ||
      expectedProgress !== beta.xp_into_level ||
      expectedNeeded !== beta.xp_for_next_level ||
      beta.beta_level_max !== (beta.level === 30)) {
    return Object.freeze({ status: 'beta_summary_mismatch', ready: false });
  }
  const review = quoteScoutFirstDemotionReviewWindow({
    formalReleaseAtMs, accountCreatedAtMs
  });
  // A post-release signup is NOT a beta-era account. Its initial Lv.1
  // state belongs to the future approved registration workflow, not this
  // legacy beta-to-formal handoff.
  if (review.cohort === 'new') {
    return Object.freeze({ status: 'postrelease_registration_not_beta_handoff', ready: false });
  }
  return Object.freeze({
    status: 'handoff_quote_only',
    ready: false,
    sourceBetaRuleVersion: ladder.ruleVersion,
    proposed: Object.freeze({
      currentLevel: beta.level,
      highestLevel: beta.level,
      levelProgressXp: beta.xp_into_level,
      reviewAnchorMs: review.windowStartMs
    }),
    firstReviewDueAtMs: review.firstReviewDueAtMs,
    requiresServerLedgerCrossCheck: true,
    requiresFormalThresholdApproval: true,
    requiresOwnerReleaseApproval: true
  });
}
