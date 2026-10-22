// A trusted-main-only composer. Never execute candidate JavaScript.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composeCommunityStagingForwardReconcile } from
  './community-staging-forward-reconcile.mjs';

export const REVIEWED_MIGRATION_BLOB =
  'df651446da99e299005b4c8ec262c528bf477922';
export const REVIEWED_STAGING_LEDGER_DIGEST =
  '3851f0dfc1e5bdb6bc7c0e317c5c4fd4';
const APPROVED_FILE = '/tmp/novelight-community-reviewed.sql';

export function gitBlobHash(content) {
  const data = Buffer.from(content, 'utf8');
  return createHash('sha1').update(
    Buffer.from('blob ' + data.length + '\0')
  ).update(data).digest('hex');
}

export function composeReviewedForwardSQL(sql, expectedBlob) {
  if (expectedBlob !== REVIEWED_MIGRATION_BLOB ||
    gitBlobHash(sql) !== REVIEWED_MIGRATION_BLOB) {
    throw new Error('COMMUNITY_FORWARD_DENIED: migration blob drift');
  }
  const candidate = composeCommunityStagingForwardReconcile(sql);
  const marker = 'DO $community_forward_guard$';
  if (candidate.split(marker).length !== 2) {
    throw new Error('COMMUNITY_FORWARD_DENIED: guard insertion drift');
  }
  const fingerprint = [
    'DO $community_ledger_fingerprint$',
    'BEGIN',
    " IF (SELECT md5(string_agg(version, ',' ORDER BY version))",
    '     FROM supabase_migrations.schema_migrations)',
    "    IS DISTINCT FROM '" + REVIEWED_STAGING_LEDGER_DIGEST + "'",
    " THEN RAISE EXCEPTION 'Staging ledger fingerprint drift';",
    ' END IF;',
    'END',
    '$community_ledger_fingerprint$;',
    ''
  ].join('\n');
  return candidate.replace(marker, fingerprint + marker);
}

if (process.argv[2] === 'render') {
  try {
    if (process.argv.length !== 4 || process.argv[3] !== APPROVED_FILE) {
      throw new Error('COMMUNITY_FORWARD_DENIED: reviewed path required');
    }
    const sql = readFileSync(APPROVED_FILE, 'utf8');
    process.stdout.write(composeReviewedForwardSQL(
      sql, REVIEWED_MIGRATION_BLOB
    ));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
