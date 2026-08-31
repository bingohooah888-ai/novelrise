import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PRODUCTION_SUPABASE_REF = 'fiepaguycecrredwrcwx';
const MIGRATION_PATTERN = /^([0-9]{14})_.+\.sql$/;
const VERSION_PATTERN = /^[0-9]{14}$/;

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

function migrationRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  fail('Supabase Management API returned an unexpected query response.');
}

export async function readRemoteMigrationVersions({
  accessToken,
  projectRef,
  fetchImpl = globalThis.fetch
}) {
  if (!accessToken) {
    fail('SUPABASE_ACCESS_TOKEN is required for read-only Staging schema proof.');
  }
  if (typeof fetchImpl !== 'function') {
    fail('fetch is unavailable for Staging schema proof.');
  }

  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query:
          'select version::text as version from supabase_migrations.schema_migrations order by version',
        read_only: true
      }),
      signal: AbortSignal.timeout(20_000)
    }
  );

  if (!response.ok) {
    fail(
      `Supabase Management API read-only migration query failed with HTTP ${response.status}.`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail('Supabase Management API migration response was not valid JSON.');
  }

  const versions = migrationRows(payload).map((row) => String(row?.version ?? ''));
  if (versions.some((version) => !VERSION_PATTERN.test(version))) {
    fail('Supabase migration history contained an invalid migration version.');
  }

  const unique = [...new Set(versions)].sort();
  if (unique.length !== versions.length) {
    fail('Supabase migration history contained duplicate migration versions.');
  }

  return unique;
}

export function compareMigrationVersions(localVersions, remoteVersions) {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);

  return {
    missingRemote: localVersions.filter((version) => !remote.has(version)),
    unexpectedRemote: remoteVersions.filter((version) => !local.has(version))
  };
}

export async function verifyStagingMigrationParity(
  env = process.env,
  { fetchImpl = globalThis.fetch, migrationDir = 'supabase/migrations' } = {}
) {
  const stagingUrl =
    env.STAGING_SUPABASE_URL ||
    env.STAGING_EXPECTED_SUPABASE_URL ||
    env.SUPABASE_URL;
  const projectRef = resolveStagingProjectRef(stagingUrl);
  const localVersions = await readLocalMigrationVersions(migrationDir);
  const remoteVersions = await readRemoteMigrationVersions({
    accessToken: env.SUPABASE_ACCESS_TOKEN,
    projectRef,
    fetchImpl
  });
  const { missingRemote, unexpectedRemote } = compareMigrationVersions(
    localVersions,
    remoteVersions
  );

  if (missingRemote.length || unexpectedRemote.length) {
    const details = [];
    if (missingRemote.length) {
      details.push(`missing on Staging: ${missingRemote.join(',')}`);
    }
    if (unexpectedRemote.length) {
      details.push(`unexpected on Staging: ${unexpectedRemote.join(',')}`);
    }
    fail(`migration history does not exactly match current repository (${details.join('; ')}).`);
  }

  console.log(
    `Verified Staging migration parity for ${projectRef}: ${localVersions.length} migrations.`
  );
  return { projectRef, versions: localVersions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyStagingMigrationParity();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
