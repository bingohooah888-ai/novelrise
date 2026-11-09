import assert from 'node:assert/strict';
import test from 'node:test';
import { compileScoutFormalXpLadder } from '../api/_lib/reader-reward/formal-thresholds.js';

const betaRows = Array.from({ length: 30 }, (_, index) => ({
  level: index + 1,
  cumulative_xp: 10 * index * (index + 4),
  rule_version: 'beta-2026-09-21'
}));
// Synthetic values above Level 30, never the official Level 31..100 decision.
const proposalRows = Array.from({ length: 100 }, (_, index) => ({
  level: index + 1,
  cumulative_xp: 10 * index * (index + 4)
}));
function compile(rows = proposalRows) {
  return compileScoutFormalXpLadder({
    betaThresholdRows: betaRows,
    formalCumulativeRows: rows
  });
}

test('compiles a complete synthetic Lv.1-100 proposal into progress-gauge XP', () => {
  const result = compile();
  assert.equal(result.status, 'offline_preview_only');
  assert.equal(result.productionReady, false);
  assert.equal(result.ownerThresholdApprovalRequired, true);
  assert.equal(result.cumulativeByLevel[30], 9570);
  assert.equal(result.requiredXpByLevel[29], 610);
  assert.equal(result.requiredXpByLevel[30], 640);
  assert.equal(result.requiredXpByLevel[99], 2020);
  assert.equal(result.cumulativeByLevel[100], 101970);
  assert.equal(Object.hasOwn(result.requiredXpByLevel, '100'), false);
  assert.equal(Object.isFrozen(result.requiredXpByLevel), true);
});

test('rejects any change to existing beta Lv.1-30 XP', () => {
  assert.throws(() => compile(proposalRows.map(row =>
    row.level === 20 ? { ...row, cumulative_xp: row.cumulative_xp + 1 } : row
  )), /cannot rewrite beta/);
});

test('rejects missing, duplicated, unsorted and non-integer formal levels', () => {
  assert.throws(() => compile(proposalRows.slice(0, 99)), /Exactly 100/);
  assert.throws(() => compile(proposalRows.map(row =>
    row.level === 42 ? { ...row, level: 41 } : row
  )), /1\.\.100/);
  assert.throws(() => compile(proposalRows.map(row =>
    row.level === 42 ? { ...row, cumulative_xp: -1 } : row
  )), /increasing/);
  assert.throws(() => compile(proposalRows.map(row =>
    row.level === 42 ? { ...row, cumulative_xp: '20000' } : row
  )), /increasing/);
});

test('supports a different future OWNER choice without hardcoded Lv.31-100 values', () => {
  const alternative = proposalRows.map(row => row.level > 30
    ? { ...row, cumulative_xp: row.cumulative_xp + 50 * (row.level - 30) }
    : row);
  const result = compile(alternative);
  assert.equal(result.requiredXpByLevel[30], 690);
  assert.equal(result.requiredXpByLevel[99], 2070);
  assert.equal(result.cumulativeByLevel[30], 9570);
  assert.equal(result.productionReady, false);
});

test('rejects cumulative XP overflow rather than silently rounding it', () => {
  assert.throws(() => compile(proposalRows.map(row =>
    row.level === 100 ? { ...row, cumulative_xp: Number.MAX_SAFE_INTEGER + 1 } : row
  )), /increasing/);
});
