import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function withSqlFixtures(callback) {
  const root = mkdtempSync(join(tmpdir(), 'novelight-staging-cli-'));
  try {
    writeFileSync(join(root, 'precheck.sql'), 'SELECT 1;\n');
    writeFileSync(
      join(root, 'migration.sql'),
      'BEGIN;\nCREATE TABLE public.ai_cli_test (id bigint);\nCOMMIT;\n'
    );
    writeFileSync(join(root, 'postcheck.sql'), 'SELECT 1;\n');
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('direct rollback CLI composes an uncommitted Staging transaction', () => {
  withSqlFixtures((root) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/staging-candidate-sql.mjs', 'compose', root],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ROLLBACK;/);
    assert.doesNotMatch(result.stdout, /^COMMIT;$/m);
    assert.match(result.stdout, /CREATE TABLE public.ai_cli_test/);
  });
});

test('persistent CLI imports SQL validator without launching rollback CLI', () => {
  withSqlFixtures((root) => {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/staging-candidate-persist-sql.mjs',
        'compose',
        root,
        '20261027120000',
        '20261027120000_ai_cli_test.sql'
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /INSERT INTO supabase_migrations/);
    assert.match(result.stdout, /20261027120000/);
    assert.match(result.stdout, /CREATE TABLE public.ai_cli_test/);
    assert.match(result.stdout, /^COMMIT;$/m);
    assert.doesNotMatch(result.stdout, /^ROLLBACK;$/m);
  });
});
