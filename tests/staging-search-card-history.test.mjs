import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canonicalMigrationStatement,
  proveStagingSearchCardHistory,
  verifyStagingSearchCardHistory
} from '../scripts/verify-staging-search-card-history.mjs';

const SOURCE_PATH =
  'supabase/migrations/20260930153337_search_card_metadata.sql';
const DESCRIPTION =
  'Public search cards for at most 100 currently published novels. Published episode aggregates only; no private lifecycle, identity or body fields.';
const FUNCTION_MD5 = 'f913180101c8cd35744e51d34db1c55e';

async function evidence() {
  const source = await readFile(SOURCE_PATH, 'utf8');
  return {
    source,
    remoteRows: [
      {
        version: '20260930210000',
        name: 'search_card_metadata',
        statement_count: 1,
        statement: canonicalMigrationStatement(source),
        function_owner: 'postgres',
        function_md5: FUNCTION_MD5,
        security_definer: true,
        volatility: 's',
        anon_can_execute: true,
        authenticated_can_execute: true,
        public_can_execute: false,
        function_comment: DESCRIPTION
      }
    ]
  };
}

test('historical Staging SQL can only match the exact repository SQL body', async () => {
  const e = await evidence();
  const result = verifyStagingSearchCardHistory(e);
  assert.equal(result.classification, 'REVIEWABLE_HISTORY_VERSION_ALIAS_ONLY');
  assert.equal(result.canonical_version, '20260930153337');
  assert.equal(result.staging_version, '20260930210000');
  assert.equal(result.writes_performed, 0);
  assert.equal(result.history_repair_authorized, false);
  assert.match(result.canonical_statement_sha256, /^[a-f0-9]{64}$/);
});

test('rejects missing or conflicting Staging migration history', async () => {
  const e = await evidence();
  assert.throws(
    () => verifyStagingSearchCardHistory({ ...e, remoteRows: [] }),
    /expected precisely one old-version/
  );
  const row = e.remoteRows[0];
  for (const patch of [
    { version: '20260930153337' },
    { name: 'different' },
    { statement_count: 2 },
    { statement: row.statement + '\nselect 1;' }
  ]) {
    assert.throws(
      () =>
        verifyStagingSearchCardHistory({
          ...e,
          remoteRows: [{ ...row, ...patch }]
        }),
      /historical Staging SQL differs/
    );
  }
});

test('rejects live function or public grants drift', async () => {
  const e = await evidence();
  const row = e.remoteRows[0];
  for (const patch of [
    { function_owner: 'unexpected' },
    { function_md5: '00000000000000000000000000000000' },
    { security_definer: false },
    { volatility: 'v' },
    { anon_can_execute: false },
    { authenticated_can_execute: false },
    { public_can_execute: true },
    { function_comment: 'different' }
  ]) {
    assert.throws(
      () =>
        verifyStagingSearchCardHistory({
          ...e,
          remoteRows: [{ ...row, ...patch }]
        }),
      /function ownership, grants, definition or comment drifted/
    );
  }
});

test('rejects changed repository SQL envelope before any DB query', async () => {
  const e = await evidence();
  assert.throws(
    () => canonicalMigrationStatement(e.source.replace('begin;', 'select 1;')),
    /canonical repository migration wrapper has changed/
  );
});

test('prevents Production reads and executes only read_only Staging metadata query', async () => {
  const e = await evidence();
  let calls = 0;
  await assert.rejects(
    proveStagingSearchCardHistory(
      {
        STAGING_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co',
        SUPABASE_ACCESS_TOKEN: 'test-token'
      },
      {
        readSource: async () => e.source,
        fetchImpl: async () => {
          calls++;
        }
      }
    ),
    /refusing the Production Supabase project/
  );
  assert.equal(calls, 0);

  const report = await proveStagingSearchCardHistory(
    {
      STAGING_SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      SUPABASE_ACCESS_TOKEN: 'sensitive-test-token'
    },
    {
      readSource: async () => e.source,
      fetchImpl: async (url, request) => {
        calls++;
        assert.equal(
          url,
          'https://api.supabase.com/v1/projects/wmlzjgvxgoyrovdhbqbg/database/query'
        );
        assert.equal(request.method, 'POST');
        assert.equal(JSON.parse(request.body).read_only, true);
        assert.match(JSON.parse(request.body).query, /supabase_migrations/);
        return { ok: true, json: async () => e.remoteRows };
      }
    }
  );
  assert.equal(calls, 1);
  assert.equal(report.staging_project_ref, 'wmlzjgvxgoyrovdhbqbg');
  assert.equal(report.history_repair_authorized, false);
  assert.ok(!JSON.stringify(report).includes('sensitive-test-token'));
});
