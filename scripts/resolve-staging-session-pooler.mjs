import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveStagingProjectRef } from './verify-staging-migration-parity.mjs';
import { verifyStagingMigrationTarget } from './verify-staging-migration-target.mjs';

const PRODUCTION_SUPABASE_REF = 'fiepaguycecrredwrcwx';
const STAGING_POOLER_CONFIG = new Map([
  ['wmlzjgvxgoyrovdhbqbg', { region: 'ap-northeast-1', shards: [0, 1] }]
]);

function fail(message) {
  const error = new Error(`STAGING_POOLER_RESOLUTION_FAILED: ${message}`);
  error.category = 'STAGING_POOLER_RESOLUTION_FAILED';
  throw error;
}

export function buildStagingSessionPoolerCandidates(env = process.env) {
  const projectRef = resolveStagingProjectRef(env.STAGING_SUPABASE_URL);
  if (projectRef === PRODUCTION_SUPABASE_REF) {
    fail('refusing the Production Supabase project.');
  }

  const sourceUrl = env.STAGING_DATABASE_URL_SOURCE || env.STAGING_DATABASE_URL;
  if (!sourceUrl) {
    fail('STAGING_DATABASE_URL_SOURCE is not configured.');
  }

  const verified = verifyStagingMigrationTarget({
    ...env,
    STAGING_DATABASE_URL: sourceUrl,
    PGSSLMODE: 'require'
  });

  if (verified.connectionMode === 'session-pooler') {
    return [sourceUrl];
  }

  const config = STAGING_POOLER_CONFIG.get(projectRef);
  if (!config) {
    fail(`no reviewed Session pooler route is registered for ${projectRef}.`);
  }

  return config.shards.map((shard) => {
    const candidate = new URL(sourceUrl);
    candidate.username = `postgres.${projectRef}`;
    candidate.hostname = `aws-${shard}-${config.region}.pooler.supabase.com`;
    candidate.port = '5432';
    const value = candidate.toString();
    verifyStagingMigrationTarget({
      ...env,
      STAGING_DATABASE_URL: value,
      PGSSLMODE: 'require'
    });
    return value;
  });
}

export function selectReachableStagingSessionPooler(
  candidates,
  { runner = spawnSync, env = process.env } = {}
) {
  for (const candidate of candidates) {
    const result = runner(
      'psql',
      ['-X', '-A', '-t', '-q', '-c', 'select 1', candidate],
      {
        env: {
          ...env,
          PGSSLMODE: 'require',
          PGCONNECT_TIMEOUT: '8'
        },
        stdio: 'ignore'
      }
    );
    if (result.status === 0) {
      return candidate;
    }
  }
  fail(
    'no reviewed IPv4 Session pooler endpoint accepted the Staging credentials.'
  );
}

export function writeResolvedStagingDatabaseUrl(env = process.env) {
  if (!env.STAGING_DATABASE_URL_FILE) {
    fail(
      'STAGING_DATABASE_URL_FILE is required for secret-safe workflow handoff.'
    );
  }
  const candidates = buildStagingSessionPoolerCandidates(env);
  const selected = selectReachableStagingSessionPooler(candidates, { env });
  writeFileSync(env.STAGING_DATABASE_URL_FILE, selected, {
    encoding: 'utf8',
    mode: 0o600
  });
  return { projectRef: resolveStagingProjectRef(env.STAGING_SUPABASE_URL) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { projectRef } = writeResolvedStagingDatabaseUrl();
    console.log(
      `Resolved IPv4-compatible Staging Session pooler route for ${projectRef}.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
