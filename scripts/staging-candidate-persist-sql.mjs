// Trusted main-only persistent staging compiler: reviewed PR SQL only.
// Guards must establish an exact Staging target, one-use OWNER approval and
// matching migration history before executing the composed transaction.
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { unwrapCandidateSql } from './staging-candidate-sql.mjs';

function fail(reason) {
  throw new Error('STAGING_CANDIDATE_PERSIST_SQL_DENIED: ' + reason);
}

export function composeCandidatePersistentSql({
  version,
  migrationFile,
  precheck,
  migration,
  postcheck
}) {
  if (typeof version !== 'string' || !/^20[0-9]{12}$/u.test(version) ||
      typeof migrationFile !== 'string' ||
      !new RegExp('^' + version + '_[a-z0-9_]+\\.sql$', 'u').test(migrationFile)) {
    fail('invalid migration version or pinned filename');
  }
  const name = migrationFile.slice(15, -4);
  if (!name || name.length > 120) fail('invalid migration name');
  const a = unwrapCandidateSql(precheck, 'precheck');
  const b = unwrapCandidateSql(migration, 'migration');
  const c = unwrapCandidateSql(postcheck, 'postcheck');
  // Version and name are validated literals. This whole transaction commits
  // only after the migration AND its read-only postcheck complete successfully.
  return [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '120s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL idle_in_transaction_session_timeout = '180s';",
    'DO $already_applied$ BEGIN',
    `  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${version}') THEN`,
    "    RAISE EXCEPTION 'Candidate migration already recorded; manual recovery required';",
    '  END IF;',
    'END $already_applied$;',
    '-- Reviewed precheck from exact SHA-pinned PR blob',
    a,
    '-- Reviewed migration body, outer COMMIT removed',
    b,
    '-- Read-only postcheck within the same transaction',
    c,
    "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (" +
      `'${version}', '${name}');`,
    '-- Commit Staging migration and ledger atomically, never Production',
    'COMMIT;',
    ''
  ].join('\n');
}

if (process.argv[2] === 'compose') {
  try {
    if (process.argv.length !== 6) fail('exact root, version, filename required');
    const root = process.argv[3];
    const version = process.argv[4];
    const migrationFile = basename(process.argv[5]);
    if (migrationFile !== process.argv[5]) fail('filename must not be a path');
    process.stdout.write(composeCandidatePersistentSql({
      version,
      migrationFile,
      precheck: readFileSync(join(root, 'precheck.sql'), 'utf8'),
      migration: readFileSync(join(root, 'migration.sql'), 'utf8'),
      postcheck: readFileSync(join(root, 'postcheck.sql'), 'utf8')
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
