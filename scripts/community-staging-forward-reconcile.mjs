// Offline SQL composer only. NEVER opens a database or executes SQL.
// The generated script is NOT an authorized Staging workflow or an approval.
// A future trusted-main, OWNER-gated runner must pin this file and the exact
// canonical migration Git blobs, prove the target project, and require new
// single-use Staging approval before executing anything.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CANONICAL_PATH =
  'supabase/migrations/20261014052000_community_plaza_phase1.sql';
const VERSION = '20261014052000';

function fail(message) {
  throw new Error('COMMUNITY_STAGING_FORWARD_RECONCILE_DENIED: ' + message);
}

export function composeCommunityStagingForwardReconcile(candidateSQL) {
  if (
    typeof candidateSQL !== 'string' ||
    candidateSQL.length < 10000 ||
    candidateSQL.length > 150000 ||
    candidateSQL.includes('\0')
  ) {
    fail('invalid canonical candidate migration');
  }

  const lines = candidateSQL.replaceAll('\r\n', '\n').split('\n');
  const wrapperStarts = lines.filter((line) => /^BEGIN;$/u.test(line));
  const wrapperEnds = lines.filter((line) => /^COMMIT;$/u.test(line));
  if (
    wrapperStarts.length !== 1 ||
    wrapperEnds.length !== 1 ||
    !lines.some((line) =>
      line.includes('-- NOVELIGHT Community Plaza Phase 1')) ||
    !lines.some((line) => line.includes('migration ' + VERSION))
  ) {
    fail('canonical migration wrapper/version mismatch');
  }
  const trimmed = candidateSQL.trimEnd();
  if (!trimmed.endsWith('\nCOMMIT;') ||
    candidateSQL.includes('\\set') ||
    /(^\\|^\s*(?:ROLLBACK|SAVEPOINT|PREPARE TRANSACTION|COPY))/imu.test(
      candidateSQL
    ) ||
    /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?supabase_migrations\./iu.test(
      candidateSQL
    )) {
    fail('unsafe transaction/meta-command/ledger modification');
  }

  const canonicalBody = lines
    .filter((line) => line !== 'BEGIN;' && line !== 'COMMIT;')
    .join('\n');

  // This is intentionally a narrow fingerprint of the observed 2026-10-22
  // Staging-only drift. A different ledger or any user-generated community
  // data halts the operation before schema writes; do not relax these checks.
  const guard = [
    'DO $community_forward_guard$',
    'BEGIN',
    " IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>188",
    " OR (SELECT count(*) FROM supabase_migrations.schema_migrations",
    "     WHERE version='" + VERSION + "')<>1",
    " OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations",
    "     WHERE version IN ('20261022010000','20261022010100'))",
    ' THEN RAISE EXCEPTION',
    "  'Refusing different migration history or Production environment';",
    ' END IF;',
    ' IF (SELECT count(*) FROM public.community_runtime_control',
    '     WHERE singleton AND NOT public_enabled AND activated_at IS NULL)<>1',
    " THEN RAISE EXCEPTION 'Community public gate is not confirmed OFF';",
    ' END IF;',
    ' IF (SELECT count(*) FROM public.community_comments)<>0',
    ' OR (SELECT count(*) FROM public.community_reactions)<>0',
    ' OR (SELECT count(*) FROM public.community_notifications)<>0',
    ' OR (SELECT count(*) FROM public.community_reports)<>0',
    ' OR (SELECT count(*) FROM public.community_hidden_posts)<>0',
    ' OR (SELECT count(*) FROM public.community_user_restrictions)<>0',
    ' OR (SELECT count(*) FROM public.community_seed_shares)<>0',
    ' OR (SELECT count(*) FROM public.author_notes',
    '     WHERE show_in_timeline)<>0',
    ' OR (SELECT count(*) FROM public.reader_curation_lists',
    '     WHERE community_share_enabled)<>0',
    " THEN RAISE EXCEPTION 'Existing community content or consent; stop';",
    ' END IF;',
    ' IF EXISTS(SELECT 1 FROM information_schema.columns',
    "   WHERE table_schema='public' AND table_name='community_comments'",
    "   AND column_name='edited_at')",
    " OR to_regprocedure('public.novelight_community_comment_detail(text,uuid)')",
    '    IS NOT NULL',
    " THEN RAISE EXCEPTION 'Not the audited legacy Staging schema';",
    ' END IF;',
    'END',
    '$community_forward_guard$;'
  ].join('\n');

  const post = [
    'DO $community_forward_postcheck$',
    'BEGIN',
    ' IF (SELECT count(*) FROM public.community_runtime_control',
    '     WHERE singleton AND NOT public_enabled AND activated_at IS NULL)<>1',
    " THEN RAISE EXCEPTION 'Public gate changed during reconciliation';",
    ' END IF;',
    " IF to_regprocedure('public.novelight_community_comment_detail(text,uuid)')",
    '    IS NULL',
    " OR to_regprocedure('public.novelight_community_edit_my_comment(uuid,text)')",
    '    IS NULL',
    " OR to_regprocedure('public.novelight_community_delete_my_comment(uuid)')",
    '    IS NULL',
    " OR to_regprocedure('public.novelight_community_report_comment(uuid,text)')",
    '    IS NULL',
    " OR to_regprocedure('public.novelight_community_mark_notifications_read(bigint[])')",
    '    IS NULL',
    " OR to_regprocedure('public.novelight_admin_community_dismiss_report(uuid,uuid)')",
    '    IS NULL',
    " THEN RAISE EXCEPTION 'Required community RPC missing after replay';",
    ' END IF;',
    ' IF NOT EXISTS(SELECT 1 FROM information_schema.columns',
    "   WHERE table_schema='public' AND table_name='community_comments'",
    "   AND column_name='edited_at')",
    " THEN RAISE EXCEPTION 'Community edited_at still missing';",
    ' END IF;',
    " IF has_table_privilege('authenticated','public.community_comments','SELECT')",
    " OR has_table_privilege('authenticated','public.community_comments','INSERT')",
    " OR has_function_privilege('authenticated',",
    "   'public.novelight_admin_community_dismiss_report(uuid,uuid)','EXECUTE')",
    " THEN RAISE EXCEPTION 'Forbidden direct community privilege';",
    ' END IF;',
    " IF (SELECT count(*) FROM supabase_migrations.schema_migrations",
    "     WHERE version='" + VERSION + "')<>1",
    " THEN RAISE EXCEPTION 'Migration history changed';",
    ' END IF;',
    'END',
    '$community_forward_postcheck$;'
  ].join('\n');

  return [
    '-- OFFLINE GENERATED SQL. Dedicated Staging ONLY; no approval implied.',
    '-- Authenticated OWNER gate and project-ref verification MUST occur before psql.',
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '120s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL idle_in_transaction_session_timeout = '180s';",
    guard,
    'ALTER TABLE public.community_comments ADD COLUMN edited_at timestamptz;',
    '-- Replay canonical Phase 1 SQL only after the audited schema guard passes.',
    canonicalBody,
    '-- No migration-history insert, update, delete or repair.',
    post,
    'COMMIT;',
    ''
  ].join('\n');
}

if (process.argv[1] && import.meta.url ===
  pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== 'compose' || process.argv.length !== 3) {
      fail('usage: node scripts/community-staging-forward-reconcile.mjs compose');
    }
    process.stdout.write(composeCommunityStagingForwardReconcile(
      readFileSync(CANONICAL_PATH, 'utf8')
    ));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
