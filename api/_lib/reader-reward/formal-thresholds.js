// Draft-only formal Scout XP ladder: compile OWNER-supplied cumulative levels
// into the existing Gate 04 progress-gauge format. Never deploy or select values.
import { validateScoutBetaThresholds } from './scout-db-compatibility.js';

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Offline feature adapter for an explicitly supplied 1..100 XP table.
 * No XP amounts are decided here. The beta 1..30 cumulative ladder is immutable.
 * A row for Lv.100 defines the final 99->100 step, not a required Lv.100->101 step.
 */
export function compileScoutFormalXpLadder({
  betaThresholdRows,
  formalCumulativeRows
}) {
  const beta = validateScoutBetaThresholds(betaThresholdRows);
  if (
    !Array.isArray(formalCumulativeRows) ||
    formalCumulativeRows.length !== 100
  ) {
    throw new RangeError('Exactly 100 formal level rows are required');
  }
  const byLevel = {};
  let preceding = -1;
  for (let index = 0; index < 100; index += 1) {
    const row = formalCumulativeRows[index];
    const level = index + 1;
    if (
      row === null ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      row.level !== level ||
      !integer(row.cumulative_xp) ||
      row.cumulative_xp <= preceding
    ) {
      throw new RangeError(
        'Formal XP rows must be 1..100 with increasing cumulative XP'
      );
    }
    if (level <= 30 && row.cumulative_xp !== beta.cumulativeByLevel[level]) {
      throw new RangeError(
        'Formal ladder cannot rewrite beta Lv.1-30 thresholds'
      );
    }
    byLevel[level] = row.cumulative_xp;
    preceding = row.cumulative_xp;
  }
  const requiredXpByLevel = {};
  for (let level = 1; level < 100; level += 1) {
    requiredXpByLevel[level] = byLevel[level + 1] - byLevel[level];
  }
  return Object.freeze({
    status: 'offline_preview_only',
    betaRuleVersion: beta.ruleVersion,
    levelCap: 100,
    cumulativeByLevel: Object.freeze(byLevel),
    requiredXpByLevel: Object.freeze(requiredXpByLevel),
    // These values are not official until separately approved by the OWNER.
    ownerThresholdApprovalRequired: true,
    productionReady: false
  });
}
