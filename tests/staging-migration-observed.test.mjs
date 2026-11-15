import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

import {
  OBSERVED_SCOUT_STAGING_MIGRATIONS,
  verifyObservedScoutStagingMigrations
} from '../scripts/verify-observed-staging-scout-history.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const observedDir = join(root, 'supabase/staging-migrations-observed');
const productionDir = join(root, 'supabase/migrations');

function recordedRows() {
  return OBSERVED_SCOUT_STAGING_MIGRATIONS.map((item) => ({
    version: item.version,
    migration_name: item.filename.slice(15, -4),
    statement_count: 1,
    statement_sha256: item.sha256,
    statement_bytes: item.bytes
  }));
}

test('four archived SQL statements match fixed Staging evidence', async () => {
  assert.equal(OBSERVED_SCOUT_STAGING_MIGRATIONS.length, 4);
  for (const item of OBSERVED_SCOUT_STAGING_MIGRATIONS) {
    const bytes = await readFile(join(observedDir, item.filename));
    const sha = createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.length, item.bytes);
    assert.equal(sha, item.sha256);
  }

  const result = await verifyObservedScoutStagingMigrations({
    remoteRows: recordedRows(),
    observedDir,
    productionDir
  });
  assert.equal(result.status, 'CONTENT_MATCH_ONLY_OWNER_APPROVAL_UNVERIFIED');
});

test('missing, duplicated or corrupted metadata fails closed', async () => {
  const rows = recordedRows();
  const wrongHash = {
    ...rows[0],
    statement_sha256: '0'.repeat(64)
  };
  const invalid = [
    rows.slice(1),
    [...rows, rows[0]],
    [wrongHash, ...rows.slice(1)]
  ];

  for (const remoteRows of invalid) {
    await assert.rejects(
      verifyObservedScoutStagingMigrations({
        remoteRows,
        observedDir,
        productionDir
      }),
      /SCHEMA_DRIFT/
    );
  }
});
