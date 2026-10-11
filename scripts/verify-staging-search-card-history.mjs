// Evidence-only Staging history equivalence. Never mutates databases.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolveStagingProjectRef } from './verify-staging-migration-parity.mjs';

export const STAGING_HISTORY_VERSION = '20260930210000';
export const REPOSITORY_HISTORY_VERSION = '20260930153337';
export const SEARCH_CARD_FUNCTION_MD5 = 'f913180101c8cd35744e51d34db1c55e';
const DESCRIPTION = 'Public search cards for at most 100 currently published novels. Published episode aggregates only; no private lifecycle, identity or body fields.';
const SOURCE_HEADER =
  '-- Read-only, bounded card enrichment shared by all search modes.\n' +
  '-- Existing rank lifecycle and tag tables remain the sources of truth.\n' +
  'begin;\n\n';

function stop(detail) {
  throw new Error('STAGING_HISTORY_RECONCILIATION_BLOCKED: ' + detail);
}

export function canonicalMigrationStatement(source) {
  if (typeof source !== 'string' ||
      !source.startsWith(SOURCE_HEADER) ||
      !source.endsWith('\ncommit;\n')) {
    stop('canonical repository migration wrapper has changed');
  }
  const statement = source.slice(SOURCE_HEADER.length, -'\ncommit;\n'.length).trim();
  if (!statement.startsWith('create or replace function public.novelight_search_card_metadata(') ||
      !statement.endsWith("'" + DESCRIPTION + "';")) {
    stop('canonical search-card migration statement is not the verified format');
  }
  return statement;
}

export function verifyStagingSearchCardHistory({ source, remoteRows }) {
  const expected = canonicalMigrationStatement(source);
  if (!Array.isArray(remoteRows) || remoteRows.length !== 1) {
    stop('expected precisely one old-version Staging history row');
  }
  const row = remoteRows[0];
  if (row.version !== STAGING_HISTORY_VERSION ||
      row.name !== 'search_card_metadata' ||
      Number(row.statement_count) !== 1 ||
      typeof row.statement !== 'string' ||
      row.statement.trim() !== expected) {
    stop('historical Staging SQL differs from the repository migration');
  }
  if (row.function_owner !== 'postgres' ||
      row.function_md5 !== SEARCH_CARD_FUNCTION_MD5 ||
      row.security_definer !== true ||
      row.volatility !== 's' ||
      row.anon_can_execute !== true ||
      row.authenticated_can_execute !== true ||
      row.public_can_execute !== false ||
      row.function_comment !== DESCRIPTION) {
    stop('Staging function ownership, grants, definition or comment drifted');
  }
  return {
    classification: 'REVIEWABLE_HISTORY_VERSION_ALIAS_ONLY',
    canonical_version: REPOSITORY_HISTORY_VERSION,
    staging_version: STAGING_HISTORY_VERSION,
    canonical_statement_sha256: createHash('sha256').update(expected).digest('hex'),
    live_function_definition_md5: row.function_md5,
    verified_history_row_count: 1,
    writes_performed: 0,
    history_repair_authorized: false
  };
}

const SQL = [
  'select m.version, m.name,',
  'coalesce(array_length(m.statements,1),0) as statement_count,',
  'm.statements[1] as statement,',
  'pg_get_userbyid(p.proowner) as function_owner,',
  'md5(pg_get_functiondef(p.oid)) as function_md5,',
  'p.prosecdef as security_definer, p.provolatile as volatility,',
  "obj_description(p.oid,'pg_proc') as function_comment,",
  "has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,",
  "has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,",
  "has_function_privilege('public',p.oid,'EXECUTE') as public_can_execute",
  'from supabase_migrations.schema_migrations m',
  'cross join pg_catalog.pg_proc p',
  "where m.version = '20260930210000'",
  "and p.oid = to_regprocedure('public.novelight_search_card_metadata(bigint[])')"
].join('\n');

export async function proveStagingSearchCardHistory(
  env = process.env,
  {
    sourcePath = 'supabase/migrations/20260930153337_search_card_metadata.sql',
    readSource = readFile,
    fetchImpl = globalThis.fetch
  } = {}
) {
  const ref = resolveStagingProjectRef(env.STAGING_SUPABASE_URL);
  if (!env.SUPABASE_ACCESS_TOKEN) stop('read-only Supabase token unavailable');
  if (typeof fetchImpl !== 'function') stop('read-only fetch unavailable');
  const source = await readSource(sourcePath, 'utf8');
  canonicalMigrationStatement(source);
  const response = await fetchImpl(
    'https://api.supabase.com/v1/projects/' + ref + '/database/query',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: SQL, read_only: true }),
      signal: AbortSignal.timeout(20000)
    }
  );
  if (!response.ok) stop('read-only history query failed with HTTP ' + response.status);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload :
    Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.result) ? payload.result : null;
  return {
    staging_project_ref: ref,
    ...verifyStagingSearchCardHistory({ source, remoteRows: rows })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await proveStagingSearchCardHistory();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
