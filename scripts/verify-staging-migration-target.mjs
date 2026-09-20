import { pathToFileURL } from 'node:url';
import { resolveStagingProjectRef } from './verify-staging-migration-parity.mjs';

const PRODUCTION_SUPABASE_REF = 'fiepaguycecrredwrcwx';
const SESSION_POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u;

function fail(message) {
  const error = new Error(`STAGING_TARGET_INVALID: ${message}`);
  error.category = 'STAGING_TARGET_INVALID';
  throw error;
}

export function verifyStagingMigrationTarget(env = process.env) {
  const stagingUrl = env.STAGING_SUPABASE_URL;
  const databaseUrl = env.STAGING_DATABASE_URL;
  const projectRef = resolveStagingProjectRef(stagingUrl);

  if (projectRef === PRODUCTION_SUPABASE_REF) {
    fail('refusing the Production Supabase project.');
  }
  if (!databaseUrl) {
    fail('STAGING_DATABASE_URL is not configured.');
  }
  if (env.PGSSLMODE !== 'require') {
    fail('PGSSLMODE must be exactly require.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail('STAGING_DATABASE_URL is not a valid URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('database URL must use postgres or postgresql.');
  }
  if (!parsed.username || !parsed.password) {
    fail('database URL must contain dedicated database credentials.');
  }
  if (parsed.pathname !== '/postgres') {
    fail('Staging database URL must target the postgres database.');
  }
  if (parsed.search || parsed.hash) {
    fail('database URL must not contain query parameters or fragments.');
  }

  const directHost = `db.${projectRef}.supabase.co`;
  if (parsed.hostname === directHost) {
    if (parsed.username !== 'postgres') {
      fail('direct database URL must use the Supabase postgres user.');
    }
    if (parsed.port && parsed.port !== '5432') {
      fail('direct Staging database URL must use port 5432.');
    }
    return { projectRef, connectionMode: 'direct' };
  }

  if (SESSION_POOLER_HOST.test(parsed.hostname)) {
    if (parsed.username !== `postgres.${projectRef}`) {
      fail('Session pooler username does not match STAGING_SUPABASE_URL.');
    }
    if (parsed.port !== '5432') {
      fail('Session pooler Staging database URL must use port 5432.');
    }
    return { projectRef, connectionMode: 'session-pooler' };
  }

  fail('database host does not match the dedicated Staging project.');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { projectRef, connectionMode } = verifyStagingMigrationTarget();
    console.log(
      `Verified dedicated Staging migration target: ${projectRef} (${connectionMode}).`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
