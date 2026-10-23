import { URL } from 'node:url';

const PRODUCTION_HOST = 'fiepaguycecrredwrcwx.supabase.co';
const STAGING_HOST = 'wmlzjgvxgoyrovdhbqbg.supabase.co';

/**
 * SPECIAL API traffic must never use Production Supabase from a Vercel Preview.
 * An unrecognised preview target is a hard error, never a fallback to Production.
 */
export function specialDatabaseTargetAllowed(env = process.env) {
  const vercelEnv = String(env.VERCEL_ENV || '');
  if (vercelEnv !== 'preview' && vercelEnv !== 'production') return true;
  const expectedHost = vercelEnv === 'preview' ? STAGING_HOST : PRODUCTION_HOST;
  try {
    const url = new URL(String(env.SUPABASE_URL || ''));
    return (
      url.protocol === 'https:' &&
      url.host === expectedHost &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function assertSpecialDatabaseTarget(env = process.env) {
  if (!specialDatabaseTargetAllowed(env)) {
    throw new Error('SPECIAL_DB_TARGET_MISMATCH');
  }
}
