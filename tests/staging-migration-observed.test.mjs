import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  OBSERVED_SCOUT_STAGING_MIGRATIONS,
  verifyObservedScoutStagingMigrations
} from '../scripts/verify-observed-staging-scout-history.mjs';
import {
  STAGING_ONLY_SCOUT_FILES,
  verifyStagingMigrationParity
} from '../scripts/verify-staging-migration-parity.mjs';

const stagingUrl = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'novelight-observed-scout-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const productionDir = join(root, 'supabase/migrations');
  const stagingMigrationDir = join(root, 'supabase/staging-migrations');
  const observedDir = join(root, 'supabase/staging-migrations-observed');
  for (const dir of [productionDir, stagingMigrationDir, observedDir]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(join(productionDir, '20261110172000_main.sql'), 'select 42;\n');
  const rows = [{ version: '20261110172000' }];
  for (const filename of STAGING_ONLY_SCOUT_FILES) {
    const sql = 'select 42;\n';
    await writeFile(join(stagingMigrationDir, filename), sql);
    rows.push({
      version: filename.slice(0, 14),
      migration_name: filename.slice(15, -4),
      statement_count: 1,
      statement_sha256: createHash('sha256').update(sql).digest('hex'),
      statement_bytes: Buffer.byteLength(sql)
    });
  }
  for (const item of OBSERVED_SCOUT_STAGING_MIGRATIONS) {
    const source = new URL(
      '../supabase/staging-migrations-observed/' + item.filename,
      import.meta.url
    );
    await copyFile(source, join(observedDir, item.filename));
    rows.push({
      version: item.version,
      migration_name: item.filename.slice(15, -4),
      statement_count: 1,
      statement_sha256: item.sha256,
      statement_bytes: item.bytes
    });
  }
  rows.sort((a, b) => a.version.localeCompare(b.version));
  return { productionDir, stagingMigrationDir, observedDir, rows };
}

test('all four observed archive bytes match fixed actual Staging metadata', async () => {
  assert.equal(OBSERVED_SCOUT_STAGING_MIGRATIONS.length, 4);
  for (const item of OBSERVED_SCOUT_STAGING_MIGRATIONS) {
    const file = await readFile(
      new URL('../supabase/staging-migrations-observed/' + item.filename, import.meta.url)
    );
    assert.equal(file.length, item.bytes, item.version);
    assert.equal(
      createHash('sha256').update(file).digest('hex'),
      item.sha256,
      item.version
    );
  }
});

test('four historical SQL blobs match metadata without implying OWNER approval', async (t) => {
  const f = await fixture(t);
  const result = await verifyObservedScoutStagingMigrations({
    remoteRows: f.rows,
    observedDir: f.observedDir,
    productionDir: f.productionDir
  });
  assert.equal(result.status, 'CONTENT_MATCH_ONLY_OWNER_APPROVAL_UNVERIFIED');
  assert.deepEqual(
    result.versions,
    OBSERVED_SCOUT_STAGING_MIGRATIONS.map((item) => item.version)
  );
});

test('normal Production migration parity stays fail-closed after successful historical match', async (t) => {
  const f = await fixture(t);
  const sink = {};
  await assert.rejects(
    verifyStagingMigrationParity(
      { STAGING_SUPABASE_URL: stagingUrl, SUPABASE_ACCESS_TOKEN: 'fixture-only' },
      {
        migrationDir: f.productionDir,
        stagingMigrationDir: f.stagingMigrationDir,
        observedMigrationDir: f.observedDir,
        fetchImpl: async (url, options) => {
          sink.url = url;
          sink.body = JSON.parse(options.body);
          return { ok: true, status: 200, json: async () => f.rows };
        }
      }
    ),
    /OWNER approval\/provenance is unverified/
  );
  assert.equal(sink.body.read_only, true);
  assert.match(sink.url, /wmlzjgvxgoyrovdhbqbg/);
});

test('missing, duplicate, name, SQL count, hash, and byte drift all fail', async (t) => {
  const f = await fixture(t);
  const version = OBSERVED_SCOUT_STAGING_MIGRATIONS[0].version;
  const item = f.rows.find((row) => row.version === version);
  const variants = [
    f.rows.filter((row) => row.version !== version),
    [...f.rows, item],
    f.rows.map((row) => row === item ? { ...row, migration_name: 'forged' } : row),
    f.rows.map((row) => row === item ? { ...row, statement_count: 2 } : row),
    f.rows.map((row) => row === item ? { ...row, statement_sha256: '0'.repeat(64) } : row),
    f.rows.map((row) => row === item ? { ...row, statement_bytes: 1 } : row)
  ];
  for (const rows of variants) {
    await assert.rejects(
      verifyObservedScoutStagingMigrations({
        remoteRows: rows,
        observedDir: f.observedDir,
        productionDir: f.productionDir
      }),
      /SCHEMA_DRIFT/
    );
  }
});

test('tampered archive and unexpected archived file fail closed', async (t) => {
  const f = await fixture(t);
  const original = join(f.observedDir, OBSERVED_SCOUT_STAGING_MIGRATIONS[0].filename);
  await writeFile(original, 'select false;\n');
  await assert.rejects(
    verifyObservedScoutStagingMigrations({
      remoteRows: f.rows,
      observedDir: f.observedDir,
      productionDir: f.productionDir
    }),
    /archived Staging SQL differs/
  );
  await writeFile(join(f.observedDir, 'unknown.sql'), 'select 1;\n');
  await assert.rejects(
    verifyObservedScoutStagingMigrations({
      remoteRows: f.rows,
      observedDir: f.observedDir,
      productionDir: f.productionDir
    }),
    /precisely four fixed SQL files/
  );
});

test('observed SQL must never enter Production migrations', async (t) => {
  const f = await fixture(t);
  const filename = OBSERVED_SCOUT_STAGING_MIGRATIONS[0].filename;
  await copyFile(join(f.observedDir, filename), join(f.productionDir, filename));
  await assert.rejects(
    verifyObservedScoutStagingMigrations({
      remoteRows: f.rows,
      observedDir: f.observedDir,
      productionDir: f.productionDir
    }),
    /must not enter Production migrations/
  );
});
