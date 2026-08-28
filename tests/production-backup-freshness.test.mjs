import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assessDailyBackupFreshness,
  fetchProductionBackups,
  findLatestCompletedBackup,
} from '../scripts/check-production-backup-freshness.mjs';

const NOW = Date.parse('2026-08-28T12:00:00.000Z');
const RECENT = '2026-08-28T04:00:00Z';
const OLDER = '2026-08-27T04:00:00Z';
const STALE = '2026-08-25T00:00:00Z';

function payload(backups, extra = {}) {
  return {
    pitr_enabled: false,
    backups,
    ...extra,
  };
}

function completed(insertedAt) {
  return { status: 'COMPLETED', inserted_at: insertedAt };
}

test('selects the newest completed backup', () => {
  const backups = [
    completed(OLDER),
    { status: 'FAILED', inserted_at: '2026-08-28T11:00:00Z' },
    completed(RECENT),
  ];
  const latest = findLatestCompletedBackup(payload(backups));

  assert.equal(latest.inserted_at, RECENT);
});

test('accepts a recent completed backup', () => {
  const result = assessDailyBackupFreshness(
    payload([completed(RECENT), completed(OLDER)]),
    { nowMs: NOW, maxAgeHours: 36 },
  );

  assert.equal(result.latestInsertedAt, '2026-08-28T04:00:00.000Z');
  assert.equal(result.ageHours, 8);
  assert.equal(result.completedCount, 2);
});

test('rejects stale or missing backups', () => {
  const options = { nowMs: NOW, maxAgeHours: 36 };
  const stalePayload = payload([completed(STALE)]);

  assert.throws(
    () => assessDailyBackupFreshness(stalePayload, options),
    /stale/,
  );
  assert.throws(
    () => assessDailyBackupFreshness(payload([]), options),
    /No completed Production backup/,
  );
});

test('rejects PITR because it needs a different proof model', () => {
  const pitrPayload = payload([], { pitr_enabled: true });

  assert.throws(
    () => assessDailyBackupFreshness(pitrPayload),
    /PITR is enabled/,
  );
});

test('uses only the read-only backup-list endpoint', async () => {
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

  const expectedUrl =
    'https://api.supabase.com/v1/projects/project-ref/database/backups';
  assert.equal(requestUrl, expectedUrl);
  assert.equal(requestOptions.method, 'GET');
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-token');
});

test('workflow remains read-only', () => {
  const workflowPath = new URL(
    '../.github/workflows/production-backup-freshness.yml',
    import.meta.url,
  );
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name: NOVELIGHT Production Backup Freshness/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN:/);
  assert.match(workflow, /secrets\.SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /SUPABASE_PROJECT_ID: fiepaguycecrredwrcwx/);
  assert.match(workflow, /MAX_BACKUP_AGE_HOURS: '36'/);
  assert.match(workflow, /check-production-backup-freshness\.mjs/);

  const forbidden = [
    'restore-pitr',
    'restore-to-new-project',
    'curl -X POST',
    '--request POST',
  ];
  for (const fragment of forbidden) {
    assert.equal(workflow.includes(fragment), false);
  }
});

test('diagnostic: print Prettier-normalized source', async () => {
  const prettier = await import('prettier');
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const formatted = await prettier.format(source, { parser: 'babel' });
  console.log('PRETTIER_FORMAT_START');
  console.log(formatted);
  console.log('PRETTIER_FORMAT_END');
});
