import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BACKUP_AGE_HOURS = 36;
const SUPABASE_API_BASE = 'https://api.supabase.com';

function parsePositiveNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('MAX_BACKUP_AGE_HOURS must be a positive number.');
  }
  return parsed;
}

export function findLatestCompletedBackup(payload) {
  const backups = Array.isArray(payload?.backups) ? payload.backups : [];
  return backups
    .filter((backup) => String(backup?.status || '').toUpperCase() === 'COMPLETED')
    .map((backup) => ({
      ...backup,
      timestampMs: Date.parse(String(backup?.inserted_at || '')),
    }))
    .filter((backup) => Number.isFinite(backup.timestampMs))
    .sort((a, b) => b.timestampMs - a.timestampMs)[0] ?? null;
}

export function assessDailyBackupFreshness(
  payload,
  {
    nowMs = Date.now(),
    maxAgeHours = DEFAULT_MAX_BACKUP_AGE_HOURS,
  } = {},
) {
  if (payload?.pitr_enabled === true) {
    throw new Error(
      'PITR is enabled; the daily-backup freshness checker cannot prove the latest PITR recovery point.',
    );
  }

  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error('maxAgeHours must be a positive number.');
  }

  const latest = findLatestCompletedBackup(payload);
  if (!latest) {
    throw new Error('No completed Production backup with a valid timestamp was returned.');
  }

  const ageHours = (nowMs - latest.timestampMs) / HOUR_MS;
  if (ageHours < -1) {
    throw new Error('Latest Production backup timestamp is unexpectedly in the future.');
  }
  if (ageHours > maxAgeHours) {
    throw new Error(
      `Latest completed Production backup is stale: ${ageHours.toFixed(2)}h old (limit ${maxAgeHours}h).`,
    );
  }

  const completedCount = (Array.isArray(payload?.backups) ? payload.backups : []).filter(
    (backup) => String(backup?.status || '').toUpperCase() === 'COMPLETED',
  ).length;

  return {
    latestInsertedAt: new Date(latest.timestampMs).toISOString(),
    ageHours,
    maxAgeHours,
    completedCount,
  };
}

export async function fetchProductionBackups({ token, projectRef, fetchImpl = fetch }) {
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
  if (!projectRef) throw new Error('SUPABASE_PROJECT_ID is required.');

  const response = await fetchImpl(
    `${SUPABASE_API_BASE}/v1/projects/${encodeURIComponent(projectRef)}/database/backups`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase backup-list request failed with HTTP ${response.status}.`);
  }

  return response.json();
}

async function writeStepSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const body = [
    '## Production backup freshness',
    '',
    `- Latest completed backup: \`${result.latestInsertedAt}\``,
    `- Backup age: \`${result.ageHours.toFixed(2)} hours\``,
    `- Maximum allowed age: \`${result.maxAgeHours} hours\``,
    `- Completed backups returned: \`${result.completedCount}\``,
    '',
  ].join('\n');
  await appendFile(summaryPath, body, 'utf8');
}

export async function main() {
  const maxAgeHours = parsePositiveNumber(
    process.env.MAX_BACKUP_AGE_HOURS,
    DEFAULT_MAX_BACKUP_AGE_HOURS,
  );
  const payload = await fetchProductionBackups({
    token: process.env.SUPABASE_ACCESS_TOKEN,
    projectRef: process.env.SUPABASE_PROJECT_ID,
  });
  const result = assessDailyBackupFreshness(payload, { maxAgeHours });
  console.log(
    `PASS: latest completed Production backup is ${result.latestInsertedAt} (${result.ageHours.toFixed(2)}h old; limit ${result.maxAgeHours}h).`,
  );
  console.log(`Completed backups returned: ${result.completedCount}`);
  await writeStepSummary(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
