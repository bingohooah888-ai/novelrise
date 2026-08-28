import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assessDailyBackupFreshness,
  fetchProductionBackups,
  findLatestCompletedBackup,
} from '../scripts/check-production-backup-freshness.mjs';

const NOW = Date.parse('2026-08-28T12:00:00.000Z');

function payload(backups, extra = {}) {
  return {
    pitr_enabled: false,
    backups,
    ...extra,
  };
}

test('findLatestCompletedBackup ignores failed and older backups', () => {
  const latest = findLatestCompletedBackup(
    payload([
      { status: 'COMPLETED', inserted_at: '2026-08-27T02:00:00Z' },
      { status: 'FAILED', inserted_at: '2026-08-28T11:00:00Z' },
      { status: 'COMPLETED', inserted_at: '2026-08-28T04:00:00Z' },
    ]),
  );

  assert.equal(latest.inserted_at, '2026-08-28T04:00:00Z');
});

test('assessDailyBackupFreshness accepts a recent completed backup', () => {
  const result = assessDailyBackupFreshness(
    payload([
      { status: 'COMPLETED', inserted_at: '2026-08-28T04:00:00Z' },
      { status: 'COMPLETED', inserted_at: '2026-08-27T04:00:00Z' },
    ]),
    { nowMs: NOW, maxAgeHours: 36 },
  );

  assert.equal(result.latestInsertedAt, '2026-08-28T04:00:00.000Z');
  assert.equal(result.ageHours, 8);
  assert.equal(result.completedCount, 2);
});

test('assessDailyBackupFreshness fails closed for stale or missing backups', () => {
  assert.throws(
    () =>
      assessDailyBackupFreshness(
        payload([{ status: 'COMPLETED', inserted_at: '2026-08-25T00:00:00Z' }]),
        { nowMs: NOW, maxAgeHours: 36 },
      ),
    /stale/,
  );

  assert.throws(
    () =>
      assessDailyBackupFreshness(payload([]), {
        nowMs: NOW,
        maxAgeHours: 36,
      }),
    /No completed Production backup/,
  );
});

test('assessDailyBackupFreshness fails closed if PITR is enabled', () => {
  assert.throws(
    () =>
      assessDailyBackupFreshness(
        payload([], { pitr_enabled: true }),
        { nowMs: NOW, maxAgeHours: 36 },
      ),
    /PITR is enabled/,
  );
});

test('fetchProductionBackups uses only the read-only backup-list endpoint', async () => {
  let requestUrl = null;
  let requestOptions = null;
  const fakeFetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      status: 200,
      async json() {
        return payload([]);
      },
    };
  };

  await fetchProductionBackups({
    token: 'test-token',
    projectRef: 'project-ref',
    fetchImpl: fakeFetch,
  });

  assert.equal(
    requestUrl,
    'https://api.supabase.com/v1/projects/project-ref/database/backups',
  );
  assert.equal(requestOptions.method, 'GET');
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-token');
});

test('workflow remains read-only and checks the Production backup gate', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/production-backup-freshness.yml',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(workflow, /name: NOVELIGHT Production Backup Freshness/);
  assert.match(workflow, /environment: production/);
  assert.match(
    workflow,
    /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/,
  );
  assert.match(workflow, /SUPABASE_PROJECT_ID: fiepaguycecrredwrcwx/);
  assert.match(workflow, /MAX_BACKUP_AGE_HOURS: '36'/);
  assert.match(
    workflow,
    /node scripts\/check-production-backup-freshness\.mjs/,
  );
  assert.doesNotMatch(
    workflow,
    /restore-pitr|restore-to-new-project|curl\s+-X\s+POST|--request\s+POST/i,
  );
});
