// Staging-only, read-only mount for the existing formal reader/admin handlers.
// Never enables formal launch, reward issuance, wallet mutation or a worker.
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { URL } from 'node:url';
import { createUnregisteredFormalApplication } from './formal-application-host.js';

const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING_URL = 'https://' + STAGING_REF + '.supabase.co';
const PROOF_REFERENCE = '2026-11-10T00:00:00.000Z';
const STAGING_READ_ONLY_ROLE = 'novelight_formal_reader_ro';
const SESSION_POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

export function verifyStagingReadOnlyDatabaseTarget(env) {
  const value = env.STAGING_FORMAL_RO_DATABASE_URL;
  if (env.PGSSLMODE !== 'require' || typeof value !== 'string' || !value)
    throw new Error('FORMAL_STAGING_READER_DB_INVALID');
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('FORMAL_STAGING_READER_DB_INVALID');
  }
  const credentialsOk =
    ['postgres:', 'postgresql:'].includes(target.protocol) &&
    Boolean(target.password) &&
    target.pathname === '/postgres' &&
    !target.search &&
    !target.hash;
  const direct =
    target.hostname === 'db.' + STAGING_REF + '.supabase.co' &&
    target.username === STAGING_READ_ONLY_ROLE &&
    (!target.port || target.port === '5432');
  const pooler =
    SESSION_POOLER_HOST.test(target.hostname) &&
    target.username === STAGING_READ_ONLY_ROLE + '.' + STAGING_REF &&
    target.port === '5432';
  if (!credentialsOk || !(direct || pooler))
    throw new Error('FORMAL_STAGING_READER_DB_INVALID');
  return value;
}

export function stagingReadOnlyGate(env = process.env) {
  return (
    env.VERCEL_ENV === 'preview' &&
    env.NOVELIGHT_SCOUT_FORMAL_STAGING_PROBE === 'read-only' &&
    env.STAGING_SUPABASE_URL === STAGING_URL &&
    env.STAGING_PROJECT_REF === STAGING_REF
  );
}

export function createStagingReadOnlyFormalApplication(env = process.env) {
  if (!stagingReadOnlyGate(env)) {
    throw new Error('FORMAL_STAGING_ROUTE_DISABLED');
  }
  // Never reuse migration sync's privileged postgres credentials in an HTTP route.
  const readOnlyDatabaseUrl = verifyStagingReadOnlyDatabaseTarget(env);
  if (
    typeof env.STAGING_SUPABASE_PUBLISHABLE_KEY !== 'string' ||
    !env.STAGING_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')
  ) {
    throw new Error('FORMAL_STAGING_AUTH_NOT_CONFIGURED');
  }
  const client = new pg.Pool({
    connectionString: readOnlyDatabaseUrl,
    ssl: { rejectUnauthorized: true },
    // Defense in depth: each PostgreSQL session is transaction-read-only.
    options: '-c default_transaction_read_only=on',
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    allowExitOnIdle: true
  });
  const pool = Object.freeze({
    // The request paths below use SELECT-only queries. Do not expose a
    // write-capable pg client or a transaction/connection handle.
    query(sql, params) {
      if (typeof sql !== 'string' || !/^\s*select\s/i.test(sql)) {
        throw new Error('FORMAL_STAGING_READ_ONLY_QUERY_REQUIRED');
      }
      return client.query(sql, params);
    },
    connect() {
      throw new Error('FORMAL_STAGING_TRANSACTIONS_DISABLED');
    }
  });
  const supabase = createClient(
    STAGING_URL,
    env.STAGING_SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return createUnregisteredFormalApplication({
    pool,
    supabase,
    stagingRef: STAGING_REF,
    stagingTestReferenceAt: PROOF_REFERENCE,
    // Snapshot/cutover validation must remain off until separately approved.
    unitVerification: {},
    releaseConfiguration: {
      formalRewardsEnabled: false,
      formalEarningsEnabled: false,
      formalWorkerEnabled: false,
      formalNewReaderOnboardingEnabled: false,
      productionCutoverApproved: false
    },
    trustedServerAuthorization: {
      approved: false,
      serviceRoleVerified: false,
      verifiedByTrustedServer: false,
      trustedServerVerified: false
    },
    env
  });
}

export function createFormalStagingReadOnlyHandler({
  role,
  env = process.env,
  build = createStagingReadOnlyFormalApplication
} = {}) {
  if (!['reader', 'admin'].includes(role)) {
    throw new TypeError('A fixed formal route role is required');
  }
  let application;
  return async function stagingFormalRoute(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!stagingReadOnlyGate(env)) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    if (req?.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    }
    // Do not expose exchange, AI use, initialization, payment or worker actions.
    if (
      (role === 'reader' && req.query?.view !== 'new_reader') ||
      (role === 'admin' &&
        !['new_readers', 'earning_source'].includes(req.query?.view))
    ) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    try {
      if (!application) application = await build(env);
      return role === 'reader'
        ? application.readerHttp(req, res)
        : application.adminHttp(req, res);
    } catch {
      return res.status(503).json({
        ok: false,
        error: 'FORMAL_STAGING_READ_ONLY_UNAVAILABLE'
      });
    }
  };
}
