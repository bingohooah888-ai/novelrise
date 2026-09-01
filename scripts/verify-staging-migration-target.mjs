import { pathToFileURL } from 'node:url';
import { resolveStagingProjectRef } from './verify-staging-migration-parity.mjs';

const PRODUCTION_SUPABASE_REF = 'fiepaguycecrredwrcwx';

function fail(message) {
  const error = new Error(`STAGING_TARGET_INVALID: ${message}`);
  error.category = 'STAGING_TARGET_INVALID';
  throw error;
}

export function verifyStagingMigrationTarget(env = process.env) {
  const stagingUrl = env.STAGING_SUPABASE_URL;
  const databaseUrl = env.STAGING_DATABASE_URL;
  const projectRef = resolveStagingProjectRef(stagingUrl);

  if (!databaseUrl) {
    fail('STAGING_DATABASE_URL is not configured.');
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
  if (parsed.username !== 'postgres') {
    fail('database URL must use the direct Supabase postgres user.');
  }
  if (parsed.hostname !== `db.${projectRef}.supabase.co`) {
    fail('database host does not match STAGING_SUPABASE_URL.');
  }
  if (parsed.hostname === `db.${PRODUCTION_SUPABASE_REF}.supabase.co`) {
    fail('refusing the Production Supabase project.');
  }
  if (parsed.port && parsed.port !== '5432') {
    fail('direct Staging database URL must use port 5432.');
  }
  if (parsed.pathname !== '/postgres') {
    fail('direct Staging database URL must target the postgres database.');
  }
  if (parsed.search || parsed.hash) {
    fail('database URL must not contain query parameters or fragments.');
  }

  return { projectRef };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { projectRef } = verifyStagingMigrationTarget();
    console.log(`Verified dedicated Staging migration target: ${projectRef}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
