import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCTION_SUPABASE_REF = 'fiepaguycecrredwrcwx';
const SCOUT_STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const MIGRATION_PATTERN = /^([0-9]{14})_.+\.sql$/;
const VERSION_PATTERN = /^[0-9]{14}$/;

// Four frozen, already-applied Staging-only migration versions; never deploy to Production.
export const STAGING_ONLY_SCOUT_FILES = Object.freeze([
  "20261110080421_formal_scout_level_staging_2762_20261110.sql",
  "20261111095412_scout_formal_point_usage_private5_20261111.sql",
  "20261111103051_scout_formal_earnings_private4_20261111.sql",
  "20261111104317_scout_formal_earning_functions_only_20261111.sql"
]);

function fail(message) {
  const error = new Error(`SCHEMA_DRIFT: ${message}`);
  error.category = 'SCHEMA_DRIFT';
  throw error;
}

export function resolveStagingProjectRef(value) {
  if (!value) fail('Staging Supabase URL is not configured.');

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('Staging Supabase URL is not valid.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith('.supabase.co')
  ) {
    fail('Staging Supabase URL is not an allowed HTTPS Supabase origin.');
  }

  const projectRef = parsed.hostname.slice(0, -'.supabase.co'.length);
  if (!projectRef || projectRef === PRODUCTION_SUPABASE_REF) {
    fail('refusing the Production Supabase project.');
  }

  return projectRef;
}

export async function readLocalMigrationVersions(
  migrationDir = 'supabase/migrations'
) {
  const entries = await readdir(migrationDir, { withFileTypes: true });
  const versions = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(MIGRATION_PATTERN);
    if (!match) continue;
    versions.push(match[1]);
  }

  const unique = [...new Set(versions)].sort();
  if (unique.length !== versions.length) {
    fail('local migration versions are not unique.');
  }
  if (unique.length === 0) {
    fail('no local Supabase migrations were found.');
  }

  return unique;
}

export async function readLocalStagingOnlyMigrations(dir = 'supabase/staging-migrations') {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { fail('approved Staging-only migration directory is missing.'); }
  const approved = new Set(STAGING_ONLY_SCOUT_FILES);
  if (entries.length !== approved.size || entries.some(e => !e.isFile() || !approved.has(e.name))) {
    fail('Staging-only migration files do not match the four approved filenames.');
  }
  const records = [];
  for (const filename of STAGING_ONLY_SCOUT_FILES) {
    const sql = await readFile(join(dir, filename));
    if (!sql.length) fail('empty Staging-only SQL file.');
    records.push({
      version: filename.slice(0,14),
      name: filename.slice(15,-4),
      sha256: createHash('sha256').update(sql).digest('hex'),
      bytes: sql.length
    });
  }
  return records;
}

function migrationRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  fail('Supabase Management API returned an unexpected query response.');
}

export async function readRemoteMigrationHistory({ accessToken, projectRef, fetchImpl = globalThis.fetch }) {
  if (!accessToken) fail('SUPABASE_ACCESS_TOKEN is required for read-only Staging schema proof.');
  if (typeof fetchImpl !== 'function') fail('fetch is unavailable for Staging schema proof.');
  if (!projectRef || projectRef === PRODUCTION_SUPABASE_REF) fail('refusing the Production Supabase project.');
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`,{
    method:'POST',
    headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      query:"select version::text as version, name::text as migration_name, cardinality(statements) as statement_count, encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') as statement_sha256, octet_length(statements[1]) as statement_bytes from supabase_migrations.schema_migrations order by version",
      read_only:true
    }),
    signal:AbortSignal.timeout(20_000)
  });
  if (!response.ok) fail(`Supabase Management API read-only migration query failed with HTTP ${response.status}.`);
  let payload;
  try { payload = await response.json(); } catch { fail('Supabase Management API migration response was not valid JSON.'); }
  const rows = migrationRows(payload);
  if (rows.some(r => typeof r?.version !== 'string' || !VERSION_PATTERN.test(r.version))) {
    fail('Supabase migration history contained an invalid migration version.');
  }
  const versions = rows.map(r => r.version);
  if (new Set(versions).size !== versions.length) fail('Supabase migration history contained duplicate migration versions.');
  return rows;
}

export async function readRemoteMigrationVersions(options) {
  return (await readRemoteMigrationHistory(options)).map(row => row.version);
}

export function compareMigrationVersions(localVersions, remoteVersions) {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);

  return {
    missingRemote: localVersions.filter((version) => !remote.has(version)),
    unexpectedRemote: remoteVersions.filter((version) => !local.has(version))
  };
}

export function assertStagingOnlyParity(localVersions, stagingOnly, remoteRows) {
  const approvedVersions = new Set(STAGING_ONLY_SCOUT_FILES.map(f => f.slice(0,14)));
  const approvedNames = new Map(STAGING_ONLY_SCOUT_FILES.map(f => [f.slice(0,14),f.slice(15,-4)]));
  const local = new Set(localVersions);
  if (approvedVersions.size !== 4 || stagingOnly.length !== 4 ||
      new Set(stagingOnly.map(x=>x.version)).size !== 4) fail('approved Staging-only manifest is incomplete.');
  if (localVersions.some(v=>approvedVersions.has(v))) fail('a Staging-only migration has entered the Production migration directory.');
  const remoteVersions = remoteRows.map(r=>r.version);
  const remote = new Map(remoteRows.map(r=>[r.version,r]));
  if (remote.size !== remoteRows.length) fail('duplicate remote migration versions.');
  const expected = new Set([...local,...approvedVersions]);
  const missingRemote = localVersions.filter(v=>!remote.has(v));
  const missingStagingOnly = [...approvedVersions].filter(v=>!remote.has(v));
  const unexpectedRemote = remoteVersions.filter(v=>!expected.has(v));
  if (missingRemote.length || missingStagingOnly.length || unexpectedRemote.length) {
    const issues=[];
    if(missingRemote.length)issues.push(`missing on Staging: ${missingRemote.join(',')}`);
    if(missingStagingOnly.length)issues.push(`missing approved Staging-only: ${missingStagingOnly.join(',')}`);
    if(unexpectedRemote.length)issues.push(`unexpected on Staging: ${unexpectedRemote.join(',')}`);
    fail(`migration history does not match approved scope (${issues.join('; ')}).`);
  }
  for(const item of stagingOnly){
    const row=remote.get(item.version);
    if(!approvedVersions.has(item.version) ||
       item.name!==approvedNames.get(item.version) ||
       row?.migration_name!==item.name ||
       row?.statement_count!==1 ||
       row?.statement_sha256!==item.sha256 ||
       row?.statement_bytes!==item.bytes) fail(`approved Staging-only migration SQL/name drift: ${item.version}.`);
  }
}

export async function verifyStagingMigrationParity(env = process.env, {
  fetchImpl=globalThis.fetch,
  migrationDir='supabase/migrations',
  stagingMigrationDir='supabase/staging-migrations'
}={}) {
  const stagingUrl=env.STAGING_SUPABASE_URL || env.STAGING_EXPECTED_SUPABASE_URL || env.SUPABASE_URL;
  const projectRef=resolveStagingProjectRef(stagingUrl);
  if(projectRef!==SCOUT_STAGING_REF) fail('approved SCOUT Staging-only exception requires the dedicated Staging project.');
  const [localVersions,stagingOnly]=await Promise.all([
    readLocalMigrationVersions(migrationDir),readLocalStagingOnlyMigrations(stagingMigrationDir)
  ]);
  const remoteRows=await readRemoteMigrationHistory({
    accessToken:env.SUPABASE_ACCESS_TOKEN,projectRef,fetchImpl
  });
  assertStagingOnlyParity(localVersions,stagingOnly,remoteRows);
  console.log(`Verified strict Staging migration parity for ${projectRef}: ${localVersions.length} Production-track + four fixed Staging-only migrations.`);
  return {projectRef,versions:localVersions};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyStagingMigrationParity();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
