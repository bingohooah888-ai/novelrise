import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  compareMigrationLedgers,
  readLocalMigrationVersions
} from '../scripts/check-ai-review-migration-parity.mjs';

const proposal = new URL(
  '../reports/sql/novelight_ai_review_candidates_PROPOSAL.sql',
  import.meta.url
);

test('Git migration versions are unique and formatted', async () => {
  const versions = await readLocalMigrationVersions();
  assert.ok(versions.length > 0);
  assert.equal(new Set(versions).size, versions.length);
  assert.ok(versions.every((value) => /^\d{14}$/.test(value)));
});

test('matching Git, staging and production ledgers pass without writes', async () => {
  const local = await readLocalMigrationVersions();
  const result = compareMigrationLedgers({
    local,
    staging: local.map((version) => ({ version })),
    production: [...local].reverse()
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {
    local: local.length,
    staging: local.length,
    production: local.length
  });
});

test('untracked staging migrations are a hard error even when totals match', () => {
  const result = compareMigrationLedgers({
    local: ['20261027090000', '20261027120000'],
    staging: ['20261027090000', '20261028020331'],
    production: ['20261027090000', '20261027120000']
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.staging.extra, ['20261028020331']);
  assert.deepEqual(result.staging.missing, ['20261027120000']);
  assert.deepEqual(result.production.extra, []);
});

test('previous staging-only additions must fail ledger parity gate', () => {
  const baseline = ['20261027090000', '20261027120000'];
  const result = compareMigrationLedgers({
    local: baseline,
    staging: [
      ...baseline,
      '20261028020331',
      '20261028020804'
    ],
    production: baseline
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.staging.extra, [
    '20261028020331',
    '20261028020804'
  ]);
});

test('invalid or duplicated migration versions fail closed', () => {
  for (const list of [
    ['20261027120000', '20261027120000'],
    ['20261027120000', 'not-a-version'],
    [{ name: 'no-version' }],
    null
  ]) {
    assert.throws(
      () =>
        compareMigrationLedgers({
          local: list,
          staging: [],
          production: []
        }),
      /INVALID_MIGRATION_LEDGER/
    );
  }
});

test('proposed SQL rejects false and empty evidence before insertion', async () => {
  const sql = await readFile(proposal, 'utf8');
  const validate = sql.slice(
    sql.indexOf('for v_candidate in'),
    sql.indexOf('insert into public.novelight_ai_review_candidates')
  );
  assert.ok(validate.length > 0);
  assert.match(validate, /pg_catalog\.strpos\(v_body, v_candidate ->> 'evidence'\) = 0/);
  for (const field of ['key', 'summary', 'evidence']) {
    assert.ok(validate.includes("pg_catalog.btrim(v_candidate ->> '" + field + "') = ''"));
  }
  assert.match(sql, /enable row level security/);
  assert.match(sql, /current_user <> 'service_role'/);
  assert.doesNotMatch(sql, /security definer/i);
});

test('review SQL stays a proposal, not an automatically deployed migration', async () => {
  const local = await readLocalMigrationVersions();
  const sql = await readFile(proposal, 'utf8');
  assert.match(sql, /REVIEW ONLY\. NOT a runnable migration/);
  assert.ok(local.length > 0);
});
