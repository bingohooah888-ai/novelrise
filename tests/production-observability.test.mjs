import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  evaluateObservabilityRow,
  INTEGRITY_CHECKS,
  MONITORING_SIGNALS
} from '../scripts/evaluate-production-observability.mjs';

const sql = await readFile(
  'supabase/checks/production_beta_observability.sql',
  'utf8'
);
const verifier = await readFile(
  'scripts/verify-production-observability.sh',
  'utf8'
);

const healthyIntegrity = Object.fromEntries(
  INTEGRITY_CHECKS.map((check) => [check, true])
);

test('traffic-dependent presence signals are monitoring-only', () => {
  const integrityExpression = sql.match(
    /signup_name_migration_applied[\s\S]*?as integrity_ok/
  )?.[0];
  const monitoringExpression = sql.match(
    /acquisition_claims_present[\s\S]*?as monitoring_ok/
  )?.[0];

  assert.ok(integrityExpression);
  assert.ok(monitoringExpression);

  for (const signal of MONITORING_SIGNALS) {
    assert.equal(integrityExpression.includes(signal), false);
    assert.equal(monitoringExpression.includes(signal), true);
  }

  assert.match(sql, /integrity_ok as ok/);
});

test('missing organic activity does not fail deterministic integrity', () => {
  const row = {
    ...healthyIntegrity,
    acquisition_claims_present: false,
    lifecycle_rows_present: false,
    recent_activity_present: false,
    integrity_ok: true,
    monitoring_ok: false,
    ok: true
  };

  const result = evaluateObservabilityRow(row);
  assert.equal(result.integrityOk, true);
  assert.equal(result.monitoringOk, false);
  assert.deepEqual(result.missingMonitoringSignals, MONITORING_SIGNALS);
});

test('deterministic integrity failure remains blocking', () => {
  const row = {
    ...healthyIntegrity,
    activity_rows_valid: false,
    acquisition_claims_present: true,
    lifecycle_rows_present: true,
    recent_activity_present: true,
    integrity_ok: false,
    monitoring_ok: true,
    ok: false
  };

  const result = evaluateObservabilityRow(row);
  assert.equal(result.integrityOk, false);
  assert.deepEqual(result.failedIntegrityChecks, ['activity_rows_valid']);
});

test('all monitoring signals can be present without changing integrity semantics', () => {
  const row = {
    ...healthyIntegrity,
    acquisition_claims_present: true,
    lifecycle_rows_present: true,
    recent_activity_present: true,
    integrity_ok: true,
    monitoring_ok: true,
    ok: true
  };

  const result = evaluateObservabilityRow(row);
  assert.equal(result.integrityOk, true);
  assert.equal(result.monitoringOk, true);
  assert.deepEqual(result.missingMonitoringSignals, []);
});

test('Production verifier delegates exit semantics to the tested evaluator', () => {
  assert.match(
    verifier,
    /node scripts\/evaluate-production-observability\.mjs "\$result_file"/
  );
  assert.doesNotMatch(verifier, /\$row\.ok == true/);
});
