import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  STAGING_ONLY_SCOUT_FILES,
  readRemoteMigrationVersions,
  resolveStagingProjectRef,
  verifyStagingMigrationParity
} from '../scripts/verify-staging-migration-parity.mjs';

const stagingUrl = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const productionVersion = '20261110172000';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'novelight-staging-parity-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const migrationDir = join(root, 'supabase/migrations');
  const stagingMigrationDir = join(root, 'supabase/staging-migrations');
  await mkdir(migrationDir, { recursive: true });
  await mkdir(stagingMigrationDir, { recursive: true });
  await writeFile(
    join(migrationDir, productionVersion + '_main.sql'),
    'select 42;\n'
  );
  const rows = [{ version: productionVersion }];
  for (const filename of STAGING_ONLY_SCOUT_FILES) {
    const sql = '-- example\nselect 42;\n';
    await writeFile(join(stagingMigrationDir, filename), sql);
    rows.push({
      version: filename.slice(0, 14),
      migration_name: filename.slice(15, -4),
      statement_count: 1,
      statement_sha256: createHash('sha256').update(sql).digest('hex'),
      statement_bytes: Buffer.byteLength(sql)
    });
  }
  rows.sort((a, b) => a.version.localeCompare(b.version));
  return { root, migrationDir, stagingMigrationDir, rows };
}
function fetchFor(rows, sink = {}) {
  return async (url, request) => {
    sink.url = url;
    sink.request = request;
    return { ok: true, status: 201, json: async () => rows };
  };
}
function verify(f, rows, fetchImpl, url = stagingUrl) {
  return verifyStagingMigrationParity(
    { STAGING_SUPABASE_URL: url, SUPABASE_ACCESS_TOKEN: 'test-access-token' },
    {
      migrationDir: f.migrationDir,
      stagingMigrationDir: f.stagingMigrationDir,
      fetchImpl
    }
  );
}

test('Production and unknown Staging project refs are refused', async (t) => {
  assert.throws(
    () => resolveStagingProjectRef('https://fiepaguycecrredwrcwx.supabase.co'),
    /refusing the Production Supabase project/
  );
  const f = await fixture(t);
  await assert.rejects(
    verify(f, f.rows, fetchFor(f.rows), 'https://other.supabase.co'),
    /requires the dedicated Staging project/
  );
});

test('strict Staging SQL hash checks use read-only query', async (t) => {
  const f = await fixture(t);
  const sink = {};
  const result = await verify(f, f.rows, fetchFor(f.rows, sink));
  assert.deepEqual(result.versions, [productionVersion]);
  assert.equal(result.projectRef, 'wmlzjgvxgoyrovdhbqbg');
  assert.match(sink.url, /wmlzjgvxgoyrovdhbqbg/);
  assert.equal(sink.request.method, 'POST');
  const body = JSON.parse(sink.request.body);
  assert.equal(body.read_only, true);
  assert.match(body.query, /sha256\(convert_to\(statements\[1\]/);
});

test('missing Production-track migration is blocked', async (t) => {
  const f = await fixture(t);
  const rows = f.rows.filter((r) => r.version !== productionVersion);
  await assert.rejects(
    verify(f, rows, fetchFor(rows)),
    /missing on Staging: 20261110172000/
  );
});

test('rejects a missing fixed Staging migration', async (t) => {
  const f = await fixture(t);
  const rows = f.rows.filter((r) => r.version !== '20261110080421');
  await assert.rejects(
    verify(f, rows, fetchFor(rows)),
    /missing approved Staging-only: 20261110080421/
  );
});

test('unknown extra remote migration is blocked', async (t) => {
  const f = await fixture(t);
  const rows = [...f.rows, { version: '20991231235959' }];
  await assert.rejects(
    verify(f, rows, fetchFor(rows)),
    /unexpected on Staging: 20991231235959/
  );
});

test('rejects name, count, SHA-256 and byte drift', async (t) => {
  const f = await fixture(t);
  const row = f.rows.find((r) => r.version === '20261110080421');
  for (const mutation of [
    { migration_name: 'unknown' },
    { statement_count: 2 },
    { statement_sha256: '0'.repeat(64) },
    { statement_bytes: row.statement_bytes + 1 }
  ]) {
    const rows = f.rows.map((r) => r === row ? { ...r, ...mutation } : r);
    await assert.rejects(verify(f, rows, fetchFor(rows)), /SQL\/name drift/);
  }
});

test('duplicate remote versions are blocked', async (t) => {
  const f = await fixture(t);
  const rows = [...f.rows, f.rows[0]];
  await assert.rejects(
    verify(f, rows, fetchFor(rows)),
    /duplicate migration versions/
  );
});

test('unexpected Staging-only SQL file is blocked', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.stagingMigrationDir, 'unexpected.sql'), 'select 0;');
  await assert.rejects(
    verify(f, f.rows, fetchFor(f.rows)),
    /four approved filenames/
  );
});

test('blocks SCOUT SQL in Production migrations', async (t) => {
  const f = await fixture(t);
  const name = STAGING_ONLY_SCOUT_FILES[0];
  await writeFile(
    join(f.migrationDir, name),
    await readFile(join(f.stagingMigrationDir, name))
  );
  await assert.rejects(
    verify(f, f.rows, fetchFor(f.rows)),
    /entered the Production migration directory/
  );
});

test('a local Staging-only SQL modification is blocked', async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.stagingMigrationDir, STAGING_ONLY_SCOUT_FILES[2]),
    'select false;'
  );
  await assert.rejects(verify(f, f.rows, fetchFor(f.rows)), /SQL\/name drift/);
});

test('recovery audit retains version-only rows', async () => {
  const versions = ['20261110080421'];
  assert.deepEqual(
    await readRemoteMigrationVersions({
      accessToken: 'test-access-token',
      projectRef: 'wmlzjgvxgoyrovdhbqbg',
      fetchImpl: fetchFor(versions.map((version) => ({ version })))
    }),
    versions
  );
});

test('a failed query does not expose its access token', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    verifyStagingMigrationParity(
      {
        STAGING_SUPABASE_URL: stagingUrl,
        SUPABASE_ACCESS_TOKEN: 'sensitive-token-value'
      },
      {
        migrationDir: f.migrationDir,
        stagingMigrationDir: f.stagingMigrationDir,
        fetchImpl: async () => ({ ok: false, status: 403 })
      }
    ),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /sensitive-token-value/);
      return true;
    }
  );
});
