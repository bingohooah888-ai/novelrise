import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OBSERVED_SCOUT_STAGING_MIGRATIONS,
  verifyObservedScoutStagingMigrations
} from '../scripts/verify-observed-staging-scout-history.mjs';
import {
  verifyStagingMigrationParity
} from '../scripts/verify-staging-migration-parity.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const observedDir = join(root, 'supabase/staging-migrations-observed');
const productionDir = join(root, 'supabase/migrations');
const stagingMigrationDir = join(root, 'supabase/staging-migrations');
const stagingUrl = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';

function metadata() {
  return OBSERVED_SCOUT_STAGING_MIGRATIONS.map((item) => ({
    version: item.version,
    migration_name: item.filename.slice(15, -4),
    statement_count: 1,
    statement_sha256: item.sha256,
    statement_bytes: item.bytes
  }));
}

function changedRow(field, value) {
  return metadata().map((row, index) => {
    if (index === 0) return { ...row, [field]: value };
    return row;
  });
}

test('four archived SQL digests are exact', async () => {
  assert.equal(OBSERVED_SCOUT_STAGING_MIGRATIONS.length, 4);
  for (const item of OBSERVED_SCOUT_STAGING_MIGRATIONS) {
    const bytes = await readFile(join(observedDir, item.filename));
    assert.equal(bytes.length, item.bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, item.sha256);
  }
});

test('metadata match does not authorize Staging', async () => {
  const evidence = await verifyObservedScoutStagingMigrations({
    remoteRows: metadata(),
    observedDir,
    productionDir
  });
  assert.equal(
    evidence.status,
    'CONTENT_MATCH_ONLY_OWNER_APPROVAL_UNVERIFIED'
  );
});

test('missing and corrupted metadata fail closed', async () => {
  const rows = metadata();
  const candidates = [
    rows.slice(1),
    [...rows, rows[0]],
    changedRow('migration_name', 'forged'),
    changedRow('statement_count', 2),
    changedRow('statement_sha256', '0'.repeat(64)),
    changedRow('statement_bytes', 1)
  ];
  for (const remoteRows of candidates) {
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

test('Production parity blocks unapproved history', async () => {
  const env = {
    STAGING_SUPABASE_URL: stagingUrl,
    SUPABASE_ACCESS_TOKEN: 'offline-fixture'
  };
  const options = {
    migrationDir: productionDir,
    stagingMigrationDir,
    observedMigrationDir: observedDir,
    fetchImpl: async (url, req) => {
      assert.match(url, /wmlzjgvxgoyrovdhbqbg/);
      assert.equal(JSON.parse(req.body).read_only, true);
      return { ok: true, status: 200, json: async () => metadata() };
    }
  };
  await assert.rejects(
    verifyStagingMigrationParity(env, options),
    /OWNER approval\/provenance is unverified/
  );
});

test('tampered observed SQL fails closed', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'novelight-scout-'));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  for (const item of OBSERVED_SCOUT_STAGING_MIGRATIONS) {
    await copyFile(
      join(observedDir, item.filename),
      join(temp, item.filename)
    );
  }
  const changed = OBSERVED_SCOUT_STAGING_MIGRATIONS[0].filename;
  await writeFile(join(temp, changed), 'select false;\n');
  await assert.rejects(
    verifyObservedScoutStagingMigrations({
      remoteRows: metadata(),
      observedDir: temp,
      productionDir
    }),
    /archived Staging SQL differs/
  );
});

test('unexpected SQL and Production copies are blocked', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'novelight-scout-'));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const prod = join(temp, 'migrations');
  await mkdir(prod);
  await writeFile(join(temp, 'unexpected.sql'), 'select 1;\n');
  await assert.rejects(
    verifyObservedScoutStagingMigrations({
      remoteRows: metadata(),
      observedDir: temp,
      productionDir: prod
    }),
    /precisely four fixed SQL files/
  );
  const name = OBSERVED_SCOUT_STAGING_MIGRATIONS[0].filename;
  await writeFile(join(prod, name), 'select 1;\n');
  await assert.rejects(
    verifyObservedScoutStagingMigrations({
      remoteRows: metadata(),
      observedDir,
      productionDir: prod
    }),
    /must not enter Production migrations/
  );
});
