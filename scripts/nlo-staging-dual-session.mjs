import { pathToFileURL } from 'node:url';

// NOVELIGHT 02-07-05: explicit Staging-only, read-only, 2-session overlap proof.
// This module does NOT create test data, call CAS, or accept arbitrary SQL.
// A later CAS action requires independent review of the fixture lifecycle.
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const PG_PORT = '5432';
const SLEEP_SECONDS = 2;
const MIN_OVERLAP_MS = 250;

export class NloStagingDualSessionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NloStagingDualSessionError';
    this.code = code;
  }
}

function deny(code) {
  throw new NloStagingDualSessionError(code);
}

export function validateStagingConnectionConfig(env) {
  if (env.NLO_STAGING_DUAL_SESSION_ENABLED !== 'true' ||
      env.NLO_STAGING_DUAL_SESSION_PROJECT_REF !== STAGING_REF) {
    deny('nlo_staging_dual_session_disabled');
  }
  const raw = env.NLO_STAGING_DUAL_SESSION_DATABASE_URL;
  if (typeof raw !== 'string' || raw.length > 4096 || raw.length < 30 || /[\r\n]/u.test(raw)) {
    deny('nlo_staging_database_url_unavailable');
  }
  let url;
  try { url = new URL(raw); } catch { deny('nlo_staging_database_url_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.pathname !== '/postgres' || url.port !== PG_PORT ||
      !url.password || url.password.length > 2048 ||
      url.search !== '' || url.hash !== '') {
    deny('nlo_staging_database_scope_denied');
  }
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === 'db.' + STAGING_REF + '.supabase.co' && user === 'postgres';
  const pooled = /^[a-z0-9-]+[.]pooler[.]supabase[.]com$/u.test(url.hostname) &&
    user === 'postgres.' + STAGING_REF;
  if (!direct && !pooled) deny('nlo_staging_database_scope_denied');
  return raw; // Return only to the DB client constructor; never log or serialize.
}

function isoDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.valueOf())) deny('nlo_staging_invalid_timestamp');
  return d.toISOString();
}

async function queryTime(client) {
  const result = await client.query('SELECT pg_backend_pid()::int AS pid, clock_timestamp() AS ts');
  if (result?.rows?.length !== 1) deny('nlo_staging_unexpected_query_result');
  const row = result.rows[0];
  if (!Number.isInteger(row.pid) || row.pid <= 0) deny('nlo_staging_invalid_backend');
  return { pid: row.pid, ts: isoDate(row.ts) };
}

export async function runNloStagingDualSessionOverlap({
  env = process.env,
  clientFactory
} = {}) {
  const connectionString = validateStagingConnectionConfig(env);
  let makeClient = clientFactory;
  if (!makeClient) {
    const { Client } = await import('pg'); // Existing root dependency, pinned in package.json.
    makeClient = options => new Client(options);
  }
  const clients = [0, 1].map(() => makeClient({
    connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
    statement_timeout: 6000,
    application_name: 'novelight-staging-dual-readonly-020705'
  }));
  const began = [false, false];
  try {
    await Promise.all(clients.map(client => client.connect()));
    for (let i = 0; i < 2; i++) {
      await clients[i].query('BEGIN TRANSACTION READ ONLY');
      began[i] = true;
    }
    const first = await Promise.all(clients.map(queryTime));
    if (first[0].pid === first[1].pid) deny('nlo_staging_shared_backend_denied');
    // Both sessions are in explicit read-only transactions. pg_sleep is the
    // only timed statement; no reads of users, works or checkpoints occur.
    const intervals = await Promise.all(clients.map(async (client, i) => {
      const start = await queryTime(client);
      if (start.pid !== first[i].pid) deny('nlo_staging_backend_changed');
      await client.query('SELECT pg_sleep(' + SLEEP_SECONDS + ')');
      const end = await queryTime(client);
      if (end.pid !== start.pid) deny('nlo_staging_backend_changed');
      return { pid: start.pid, start: start.ts, end: end.ts };
    }));
    const a = intervals[0];
    const b = intervals[1];
    const overlapMs = Math.max(0, Math.min(Date.parse(a.end), Date.parse(b.end)) -
      Math.max(Date.parse(a.start), Date.parse(b.start)));
    if (Date.parse(a.end) <= Date.parse(a.start) || Date.parse(b.end) <= Date.parse(b.start)) {
      deny('nlo_staging_invalid_interval');
    }
    return {
      scope: 'Staging', projectRef: STAGING_REF, access: 'read_only',
      operation: 'two_session_overlap',
      verdict: overlapMs >= MIN_OVERLAP_MS ? 'PASS' : 'NO_OVERLAP',
      a, b, overlapMs, minOverlapMs: MIN_OVERLAP_MS,
      fixtureCreated: false, casTested: false
    };
  } catch (error) {
    if (error instanceof NloStagingDualSessionError) throw error;
    // Do not leak connection strings, database response text, or credentials.
    deny('nlo_staging_dual_session_execution_failed');
  } finally {
    await Promise.allSettled(clients.map(async (client, i) => {
      if (began[i]) await client.query('ROLLBACK');
    }));
    await Promise.allSettled(clients.map(client => client.end()));
  }
}

// Direct NLO's existing allowlisted "npm run" can invoke this fixed script
// from an isolated PR worktree. No shell permission or Bridge reload needed.
// Never print connection strings, SQL errors, stack traces or user data.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('nlo_staging_dual_session_invalid_cli_args\n');
    process.exitCode = 1;
  } else {
    try {
      const proof = await runNloStagingDualSessionOverlap();
      process.stdout.write(JSON.stringify(proof) + '\n');
      if (proof.verdict !== 'PASS') process.exitCode = 2;
    } catch (error) {
      const code =
        error instanceof NloStagingDualSessionError
          ? error.code
          : 'nlo_staging_dual_session_execution_failed';
      process.stderr.write(code + '\n');
      process.exitCode = 1;
    }
  }
}
