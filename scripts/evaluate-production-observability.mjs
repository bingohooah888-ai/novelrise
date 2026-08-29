import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const INTEGRITY_CHECKS = [
  'signup_name_migration_applied',
  'profile_names_present',
  'acquisition_rows_valid',
  'lifecycle_rows_valid',
  'activity_rows_valid',
  'acquisition_has_lifecycle',
  'acquisition_tokens_hashed'
];

export const MONITORING_SIGNALS = [
  'acquisition_claims_present',
  'lifecycle_rows_present',
  'recent_activity_present'
];

export function getObservabilityRow(payload) {
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }

  if (Array.isArray(payload?.result)) {
    return payload.result[0] ?? null;
  }

  return payload && typeof payload === 'object' ? payload : null;
}

export function evaluateObservabilityRow(row) {
  const failedIntegrityChecks = INTEGRITY_CHECKS.filter(
    (check) => row?.[check] !== true
  );
  const missingMonitoringSignals = MONITORING_SIGNALS.filter(
    (signal) => row?.[signal] !== true
  );

  return {
    integrityOk:
      row?.integrity_ok === true &&
      row?.ok === true &&
      failedIntegrityChecks.length === 0,
    monitoringOk:
      row?.monitoring_ok === true && missingMonitoringSignals.length === 0,
    failedIntegrityChecks,
    missingMonitoringSignals
  };
}

function diagnosticFields(row) {
  return {
    ok: row?.ok,
    integrity_ok: row?.integrity_ok,
    monitoring_ok: row?.monitoring_ok,
    signup_name_migration_applied: row?.signup_name_migration_applied,
    profile_names_present: row?.profile_names_present,
    acquisition_claims_present: row?.acquisition_claims_present,
    acquisition_rows_valid: row?.acquisition_rows_valid,
    lifecycle_rows_present: row?.lifecycle_rows_present,
    lifecycle_rows_valid: row?.lifecycle_rows_valid,
    recent_activity_present: row?.recent_activity_present,
    activity_rows_valid: row?.activity_rows_valid,
    acquisition_has_lifecycle: row?.acquisition_has_lifecycle,
    acquisition_tokens_hashed: row?.acquisition_tokens_hashed
  };
}

async function main() {
  const resultFile = process.argv[2];
  if (!resultFile) {
    throw new Error('Usage: node scripts/evaluate-production-observability.mjs <result-file>');
  }

  const payload = JSON.parse(await readFile(resultFile, 'utf8'));
  const row = getObservabilityRow(payload);
  if (!row) {
    console.error('Production beta observability result did not contain a row.');
    process.exitCode = 1;
    return;
  }

  const evaluation = evaluateObservabilityRow(row);
  if (!evaluation.integrityOk) {
    console.error('Production beta integrity checks failed.');
    console.error(JSON.stringify(diagnosticFields(row), null, 2));
    process.exitCode = 1;
    return;
  }

  console.log('Production beta integrity checks passed.');

  if (!evaluation.monitoringOk) {
    console.warn(
      `::warning title=Production beta monitoring::Non-blocking traffic signals are currently missing: ${evaluation.missingMonitoringSignals.join(', ')}`
    );
    return;
  }

  console.log('Production beta monitoring signals are present.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
