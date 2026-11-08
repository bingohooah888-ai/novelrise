// NOVELIGHT β Point10x Stage 3.8 — explicitly dispatched, fail-closed,
// Staging-only diagnostic. No mutation, backup, writer control or retries.
// Never run from a PR, import, Production, or untrusted workstation.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyStagingMigrationTarget } from './verify-staging-migration-target.mjs';
import { compilePinnedCutoverReview } from './scout-point10x-staging-cutover-adapter.mjs';

export const EXPECTED_PARENT = 'fiepaguycecrredwrcwx';
export const EXPECTED_STAGING = 'wmlzjgvxgoyrovdhbqbg';
export const EXPECTED_REPOSITORY = 'bingohooah888-ai/novelrise';
export const EXPECTED_WORKFLOW =
  EXPECTED_REPOSITORY +
  '/.github/workflows/scout-point10x-staging-identity-readonly.yml@refs/heads/main';
export const READONLY_SCOPE = 'point10x-stage38-staging-identity-readonly-v1';
export const EXPECTED_TABLES = Object.freeze([
  'scout_event_ledger',
  'scout_xp_ledger',
  'scout_point_ledger',
  'scout_badge_definitions',
  'user_scout_badges',
  'scout_point_operator_actions'
]);
export const READONLY_DIAGNOSTIC_IMPLEMENTED = true; // NEVER enables the Point cutover.

function stop(code) {
  throw Object.assign(new Error('STAGE38_HOLD:' + code), { safeCode: code });
}
const hex40 = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function verifyTrustedDispatch(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_ACTOR !== 'bingohooah888-ai' ||
    env.GITHUB_TRIGGERING_ACTOR !== 'bingohooah888-ai' ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    env.GITHUB_WORKFLOW_REF !== EXPECTED_WORKFLOW ||
    env.REQUESTED_SCOPE !== READONLY_SCOPE ||
    env.REQUESTED_CONFIRMATION !== 'STAGING READONLY IDENTITY APPROVED' ||
    !hex40(env.EXPECTED_MAIN_SHA) ||
    env.GITHUB_SHA !== env.EXPECTED_MAIN_SHA
  )
    stop('UNTRUSTED_DISPATCH');
  return Object.freeze({ sha: env.EXPECTED_MAIN_SHA, scope: READONLY_SCOPE });
}

// Supabase's Preview Branch is NOT a regular Project and must never be
// queried through /v1/projects/{stagingRef}. Only the two documented,
// credential-free-in-response parent Branch metadata endpoints are allowed.
// This is a branch identity gate, not proof of the actual PostgreSQL server:
// that separate proof requires an authenticated verify-full TLS connection.
export function inspectManagementRecords(branchResponse, namedBranchResponse) {
  const branches = Array.isArray(branchResponse)
    ? branchResponse
    : branchResponse?.branches;
  if (!Array.isArray(branches)) stop('BRANCH_LIST_UNAVAILABLE');
  // Refuse ambiguous or replaced staging records (including name/ref collisions).
  const candidates = branches.filter(
    (entry) =>
      entry?.name === 'staging' || entry?.project_ref === EXPECTED_STAGING
  );
  if (candidates.length !== 1) stop('STAGING_BRANCH_UNPROVEN');
  const listed = candidates[0];
  if (!object(namedBranchResponse)) stop('STAGING_BRANCH_DETAIL_UNAVAILABLE');
  const named = namedBranchResponse;
  const expectedId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
  // Diagnose every failed invariant in one run without exposing API values.
  // The fields, views and booleans below are fixed, non-secret vocabulary.
  const identityChecks = [
    ['id', (value) => typeof value === 'string' && expectedId.test(value)],
    ['name', (value) => value === 'staging'],
    ['project_ref', (value) => value === EXPECTED_STAGING],
    ['parent_project_ref', (value) => value === EXPECTED_PARENT],
    ['is_default', (value) => value === false],
    ['preview_project_status', (value) => value === 'ACTIVE_HEALTHY'],
    ['persistent', (value) => value === false],
    ['with_data', (value) => value === false]
  ];
  const mismatches = [];
  for (const [view, branch] of [
    ['list', listed],
    ['named', named]
  ]) {
    for (const [field, isExpected] of identityChecks) {
      const present = Object.hasOwn(branch, field);
      // Supabase named Branch GET may omit this summary-only health field.
      // The list must supply ACTIVE_HEALTHY; a present named value must match.
      if (view === 'named' && field === 'preview_project_status' && !present)
        continue;
      if (!present || !isExpected(branch[field]))
        mismatches.push({ view, field, present, matchesExpected: false });
    }
  }
  if (listed.id !== named.id)
    mismatches.push({
      view: 'crosscheck',
      field: 'id',
      present: Object.hasOwn(listed, 'id') && Object.hasOwn(named, 'id'),
      matchesExpected: false
    });
  if (mismatches.length) {
    const error = new Error('STAGE38_HOLD:STAGING_BRANCH_IDENTITY_MISMATCH');
    error.safeCode = 'STAGING_BRANCH_IDENTITY_MISMATCH';
    error.safeDiagnostics = mismatches;
    throw error;
  }
  return Object.freeze({
    // Two independently requested parent-scoped management views agree.
    managementVerified: true,
    ref: EXPECTED_STAGING,
    parentRef: EXPECTED_PARENT,
    branchId: named.id,
    // Derived pinned identity hostname, NOT a Management API DB-host claim.
    expectedDbHost: 'db.' + EXPECTED_STAGING + '.supabase.co',
    postgresVersionVerified: false
  });
}

export function inspectConnectionRoute(env, management) {
  if (!management?.managementVerified || management.ref !== EXPECTED_STAGING)
    stop('MANAGEMENT_ATTESTATION_REQUIRED');
  if (
    env.STAGING_SUPABASE_URL !==
    'https://' + EXPECTED_STAGING + '.supabase.co'
  )
    stop('STAGING_API_URL_MISMATCH');
  const source = env.STAGING_DATABASE_URL;
  if (typeof source !== 'string' || source.length === 0)
    stop('STAGING_SECRET_UNAVAILABLE');
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    stop('DATABASE_URL_INVALID');
  }
  // Reuse the established port/host/username/secret-shape validator;
  // its "require" is NOT accepted as TLS server authentication.
  let existing;
  try {
    existing = verifyStagingMigrationTarget({
      STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL,
      STAGING_DATABASE_URL: source,
      PGSSLMODE: 'require'
    });
  } catch {
    stop('DEDICATED_ROUTE_NOT_PROVEN');
  }
  if (
    existing.projectRef !== EXPECTED_STAGING ||
    !['direct', 'session-pooler'].includes(existing.connectionMode) ||
    parsed.hostname === 'db.' + EXPECTED_PARENT + '.supabase.co' ||
    parsed.search ||
    parsed.hash
  )
    stop('PRODUCTION_OR_AMBIGUOUS_ROUTE');
  if (
    existing.connectionMode === 'direct' &&
    parsed.hostname !== management.expectedDbHost
  )
    stop('DIRECT_HOST_NOT_MANAGEMENT_PINNED');
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.pathname !== '/postgres'
  )
    stop('DATABASE_URL_INVALID');
  return Object.freeze({
    connectionMode: existing.connectionMode,
    host: parsed.hostname,
    port: parsed.port || '5432',
    username: decodeURIComponent(parsed.username),
    // Password is deliberately NOT returned by this inspector.
    sslMode: 'verify-full',
    rootCert: 'system'
  });
}

export async function fetchManagementEvidence(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim())
    stop('MANAGEMENT_TOKEN_UNAVAILABLE');
  async function get(path) {
    // Endpoints are hard-coded; no arbitrary input URL, no log of response.
    let response;
    try {
      response = await fetchImpl('https://api.supabase.com/v1/' + path, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json'
        },
        redirect: 'error',
        signal: AbortSignal.timeout(7000)
      });
    } catch {
      stop('MANAGEMENT_REQUEST_FAILED');
    }
    if (!response.ok)
      stop(
        response.status === 404
          ? 'MANAGEMENT_BRANCH_NOT_FOUND'
          : 'MANAGEMENT_HTTP_NOT_OK'
      );
    try {
      return await response.json();
    } catch {
      stop('MANAGEMENT_JSON_INVALID');
    }
  }
  // Both documented endpoints return Branch metadata only; never call
  // /v1/branches/{id} (branch config may contain credentials), nor
  // /v1/projects/{stagingRef} (Preview is not a regular Project).
  return {
    branches: await get('projects/' + EXPECTED_PARENT + '/branches'),
    branch: await get('projects/' + EXPECTED_PARENT + '/branches/staging')
  };
}

// This query has no user data, no functions with mutable effects,
// no EXPLAIN ANALYZE and no DBA commands. It is only reached after
// authenticated Supabase management records and libpq verify-full.
export const SAFE_IDENTITY_SQL = [
  'BEGIN READ ONLY;',
  'SELECT json_build_object(',
  "'database', current_database(),",
  "'dbRole', current_user,",
  "'postgresMajor', split_part(current_setting('server_version'),'.',1)::integer,",
  "'ssl', (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()),",
  "'tables', (SELECT count(*) FROM (VALUES",
  EXPECTED_TABLES.map((t) => "('" + t + "')").join(','),
  ") AS expected(name) WHERE to_regclass('public.' || name) IS NOT NULL),",
  "'cronExtension', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'),",
  "'rankCronFunction', to_regprocedure('public.novelight_recalculate_work_ranks()') IS NOT NULL",
  ')::text;',
  'ROLLBACK;'
].join(' ');

// Classify psql failures in process only; discard native diagnostics.
// Never return, log, serialize or persist stderr, addresses, credentials,
// process error messages or raw connection failures. Unknown means HOLD.
export function classifyPsqlFailure(child) {
  const code = child?.error?.code;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM')
    return 'PSQL_EXECUTABLE_UNAVAILABLE';
  if (code === 'ETIMEDOUT') return 'PSQL_TIMEOUT';
  // psql exit 3 is a SQL/script failure when ON_ERROR_STOP=1.
  if (child?.status === 3) return 'PSQL_SQL_ERROR';

  // Spawned psql stderr is only inspected locally for known libpq phrases.
  // Do not include any portion in returned values or thrown errors.
  const details =
    typeof child?.stderr === 'string' ? child.stderr.slice(0, 8192) : '';
  if (
    /(?:certificate verify failed|certificate verification failed|self[- ]signed certificate|unable to get local issuer certificate|unknown ca|root certificate file|server certificate|certificate does not match|ssl error:.*certificate|sslrootcert|sslmode.*(?:invalid|unsupported))/iu.test(
      details
    )
  )
    return 'PSQL_TLS_CERTIFICATE_FAILURE';
  if (
    /(?:password authentication failed|no password supplied|fe_sendauth|sasl authentication failed|scram authentication failed|pam authentication failed|pg_hba\.conf|authentication failed)/iu.test(
      details
    )
  )
    return 'PSQL_AUTHENTICATION_FAILURE';
  if (
    /(?:timeout expired|connection timed out|operation timed out|could not connect to server:.*timeout)/iu.test(
      details
    )
  )
    return 'PSQL_TIMEOUT';
  if (
    /(?:could not translate host name|name or service not known|temporary failure in name resolution|getaddrinfo|nodename nor servname provided|connection refused|network is unreachable|no route to host|could not connect to server|server closed the connection unexpectedly)/iu.test(
      details
    )
  )
    return 'PSQL_DNS_OR_NETWORK_FAILURE';
  return 'PSQL_FAILURE_UNCLASSIFIED';
}
function runSafeReadOnlyQuery({ env, route }) {
  if (
    !route ||
    route.sslMode !== 'verify-full' ||
    route.rootCert !== 'system' ||
    !env.STAGING_DATABASE_URL
  )
    stop('TLS_ROUTE_UNVERIFIED');
  const parsed = new URL(env.STAGING_DATABASE_URL);
  const childEnv = {
    ...env,
    PGHOST: route.host,
    PGPORT: route.port,
    PGUSER: route.username,
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: 'system',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=4000'
  };
  // Neither URL nor token is placed in command args, logs, stdout or artifacts.
  delete childEnv.STAGING_DATABASE_URL;
  delete childEnv.SUPABASE_ACCESS_TOKEN;
  delete childEnv.STAGING_DATABASE_URL_SOURCE;
  let child;
  try {
    child = spawnSync(
      'psql',
      [
        '-X',
        '-q',
        '-t',
        '-A',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        SAFE_IDENTITY_SQL
      ],
      {
        env: childEnv,
        shell: false,
        encoding: 'utf8',
        timeout: 9000,
        maxBuffer: 8192,
        windowsHide: true
      }
    );
  } catch (error) {
    stop(classifyPsqlFailure({ error }));
  }
  if (child?.status !== 0 || child.error) stop(classifyPsqlFailure(child));
  let result;
  try {
    result = JSON.parse(String(child.stdout).trim());
  } catch {
    stop('PSQL_IDENTITY_OUTPUT_INVALID');
  }
  return validateCatalogReadOnlyJson(result);
}

// This exported shape-only validator never proves a real connection.
export function validateCatalogReadOnlyJson(result) {
  if (
    !object(result) ||
    result.database !== 'postgres' ||
    result.dbRole !== 'postgres' ||
    result.ssl !== true ||
    !Number.isInteger(result.postgresMajor) ||
    result.postgresMajor < 17 ||
    !Number.isInteger(result.tables) ||
    result.tables < 0 ||
    result.tables > EXPECTED_TABLES.length ||
    typeof result.cronExtension !== 'boolean' ||
    typeof result.rankCronFunction !== 'boolean'
  )
    stop('SERVER_IDENTITY_OR_SCHEMA_INVALID');
  return Object.freeze({
    status: 'NO_GO_SYNTHETIC_CATALOG_SHAPE_ONLY',
    stagingRef: EXPECTED_STAGING,
    tlsValidation: 'verify-full-system-ca',
    postgresMajor: result.postgresMajor,
    targetTablePresenceCount: result.tables,
    targetTableExpectedCount: EXPECTED_TABLES.length,
    cronExtensionPresent: result.cronExtension,
    rankCronFunctionPresent: result.rankCronFunction,
    pointConverted: false,
    ninetySecondRuntimeProven: false,
    writerFencingProven: false,
    backupRestoreProven: false
  });
}

async function runStage38() {
  const env = process.env;
  verifyTrustedDispatch(env);
  // A pinned existing candidate is necessary but cannot serve as auth.
  compilePinnedCutoverReview();
  const data = await fetchManagementEvidence(env.SUPABASE_ACCESS_TOKEN);
  const management = inspectManagementRecords(data.branches, data.branch);
  const route = inspectConnectionRoute(env, management);
  const result = runSafeReadOnlyQuery({ env, route });
  return Object.freeze({
    ...result,
    status: 'STAGING_READONLY_METADATA_VERIFIED',
    managementApiAuthenticated: true,
    liveCutoverAuthorized: false,
    nextStage: 'NO_GO_UNTIL_SINGLE_USE_APPROVAL_RESTORE_WRITER_PROOF'
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // No CLI input is accepted beyond this fixed command; never echo errors
  // originating from fetch, libpq, connection strings or remote sources.
  if (process.argv.length !== 3 || process.argv[2] !== '--live-readonly') {
    console.error('STAGE38_HOLD:EXPLICIT_LIVE_READONLY_DISPATCH_REQUIRED');
    process.exitCode = 1;
  } else {
    runStage38()
      .then((result) => {
        console.log(JSON.stringify(result));
      })
      .catch((error) => {
        const code =
          typeof error?.safeCode === 'string' &&
          /^[A-Z0-9_]+$/u.test(error.safeCode)
            ? error.safeCode
            : 'UNEXPECTED_ERROR';
        console.error('STAGE38_HOLD:' + code);
        if (
          code === 'STAGING_BRANCH_IDENTITY_MISMATCH' &&
          Array.isArray(error.safeDiagnostics)
        )
          console.error(
            'STAGE38_IDENTITY_FIELDS:' + JSON.stringify(error.safeDiagnostics)
          );
        process.exitCode = 1;
      });
  }
}
