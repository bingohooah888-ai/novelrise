// A trusted-main-only composer. Never execute candidate JavaScript.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composeCommunityStagingForwardReconcile } from
  './community-staging-forward-reconcile.mjs';

export const REVIEWED_MIGRATION_BLOB =
  'df651446da99e299005b4c8ec262c528bf477922';
export const REVIEWED_STAGING_LEDGER_DIGEST =
  '3851f0dfc1e5bdb6bc7c0e317c5c4fd4';
export const REVIEWED_STAGING_ROUTINE_COUNT = 19;
export const REVIEWED_STAGING_ROUTINE_DIGEST =
  'ccd2c2b8c66f3b9fa025b0163d75b156';
const APPROVED_FILE = '/tmp/novelight-community-reviewed.sql';

export function gitBlobHash(content) {
  const data = Buffer.from(content, 'utf8');
  return createHash('sha1').update(
    Buffer.from('blob ' + data.length + '\0')
  ).update(data).digest('hex');
}


// The existing routines are checked before any schema change. A version
// ledger alone cannot detect later changes to function definitions.
export function composeRoutineBaselineGuard() {
  const fingerprintSQL = [
    'SELECT count(*)::integer, md5(string_agg(',
    " p.proname || '(' || pg_get_function_identity_arguments(p.oid)",
    " || ')' || ':' || md5(pg_get_functiondef(p.oid)), '|'",
    ' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))',
    ' INTO routine_count, routine_digest',
    ' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace',
    " WHERE n.nspname='public'",
    " AND (p.proname LIKE 'novelight_community_%'",
    " OR p.proname LIKE 'novelight_admin_community_%'",
    ' OR p.proname IN (',
    " 'novelight_save_my_author_note_v2',",
    " 'novelight_manage_my_author_notes_v2',",
    " 'novelight_manage_my_curation_lists_v2',",
    " 'novelight_set_my_curation_community_share',",
    " 'novelight_curation_share_reset_private',",
    " 'novelight_my_seed_community_shares',",
    " 'novelight_set_my_seed_community_share'))"
  ].join('\n');
  return [
    'DO $community_routine_fingerprint$',
    'DECLARE routine_count integer; routine_digest text;',
    'BEGIN',
    fingerprintSQL + ';',
    ' IF routine_count IS DISTINCT FROM ' +
      REVIEWED_STAGING_ROUTINE_COUNT,
    " OR routine_digest IS DISTINCT FROM '" +
      REVIEWED_STAGING_ROUTINE_DIGEST + "'",
    " THEN RAISE EXCEPTION 'Staging routine fingerprint drift';",
    ' END IF;',
    'END',
    '$community_routine_fingerprint$;',
    ''
  ].join('\n');
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
  return candidate.replace(
    marker, fingerprint + composeRoutineBaselineGuard() + marker
  );
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
