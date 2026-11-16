// Staging-only formal reader credential provisioning. OFF until separately approved.
// Run only inside the OWNER-dispatched trusted-main GitHub staging Environment.
// Password, database URLs, bearer tokens and verifier values must never be logged.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { resolveVercelProjectScope } from './vercel-admin-allowlist.mjs';
import { verifyStagingMigrationTarget } from './verify-staging-migration-target.mjs';
import {
  OFFICIAL_SUPABASE_CA_FILE_PATH,
  verifyPinnedSupabaseRootCa
} from './scout-point10x-staging-identity-readonly.mjs';

const { Client } = pg;
const REPO = 'bingohooah888-ai/novelrise';
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING_URL = 'https://' + STAGING_REF + '.supabase.co';
const ROLE = 'novelight_formal_reader_ro';
const BRANCH = 'feature/scout-formal-qualified-earnings-offline-20261116';
const TEAM = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const PROJECT = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const ENV_KEY = 'STAGING_FORMAL_RO_DATABASE_URL';
const SCOPE = 'scout-formal-reader-credential-staging-v1';
const WORKFLOW =
  REPO + '/.github/workflows/scout-formal-staging-ro-provision.yml@refs/heads/main';
const HEX40 = /^[a-f0-9]{40}$/u;
const SOURCE_TABLES = Object.freeze([
  ['public', 'scout_xp_ledger', 'user_id'],
  ['public', 'scout_point_ledger', 'user_id'],
  ['public', 'valid_read_events', 'reader_id'],
  ['public', 'novel_comments', 'user_id'],
  ['novelight_formal_private', 'scout_level_state', 'user_id'],
  ['novelight_formal_private', 'scout_point_usage_wallets', 'user_id']
]);

function hold(code) {
  throw Object.assign(new Error('FORMAL_RO_PROVISION_HOLD:' + code), {
    safeCode: code
  });
}

export function verifyFormalReaderProvisionContext(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REPOSITORY !== REPO ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_WORKFLOW_REF !== WORKFLOW ||
    env.GITHUB_ACTOR !== 'bingohooah888-ai' ||
    env.GITHUB_TRIGGERING_ACTOR !== 'bingohooah888-ai' ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    !HEX40.test(env.EXPECTED_MAIN_SHA || '') ||
    env.GITHUB_SHA !== env.EXPECTED_MAIN_SHA ||
    env.FORMAL_STAGING_SCOPE !== SCOPE ||
    env.FORMAL_STAGING_CONFIRMATION !== 'STAGING FORMAL RO APPROVED' ||
    env.FORMAL_STAGING_REF !== STAGING_REF ||
    env.FORMAL_STAGING_PREVIEW_BRANCH !== BRANCH ||
    env.STAGING_SUPABASE_URL !== STAGING_URL
  ) {
    hold('UNTRUSTED_APPROVAL_CONTEXT');
  }
  if (!env.STAGING_DATABASE_URL || !env.VERCEL_API_TOKEN) {
    hold('EXISTING_STAGING_SECRETS_REQUIRED');
  }
  // Reuse the repository's strict project/route guard; transport TLS is
  // verified independently with the pinned CA below (not PGSSLMODE=require).
  try {
    verifyStagingMigrationTarget({
      STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL,
      STAGING_DATABASE_URL: env.STAGING_DATABASE_URL,
      PGSSLMODE: 'require'
    });
  } catch {
    hold('STAGING_DATABASE_IDENTITY_UNVERIFIED');
  }
  return true;
}

export function deriveFormalReaderDatabaseUrl(privilegedUrl, password) {
  if (!/^[A-Za-z0-9_-]{64}$/u.test(password)) {
    hold('GENERATED_PASSWORD_INVALID');
  }
  let url;
  try {
    url = new URL(privilegedUrl);
  } catch {
    hold('DATABASE_ROUTE_INVALID');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '5432')
  ) {
    hold('DATABASE_ROUTE_INVALID');
  }
  const direct = url.hostname === 'db.' + STAGING_REF + '.supabase.co';
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(
    url.hostname
  );
  if (
    (!direct && !pooler) ||
    decodeURIComponent(url.username) !==
      (direct ? 'postgres' : 'postgres.' + STAGING_REF)
  ) {
    hold('DATABASE_ROUTE_INVALID');
  }
  url.username = direct ? ROLE : ROLE + '.' + STAGING_REF;
  url.password = password;
  return url.toString();
}

export function makeScramVerifier(password, salt) {
  if (
    !/^[A-Za-z0-9_-]{64}$/u.test(password) ||
    !Buffer.isBuffer(salt) ||
    salt.length !== 16
  ) {
    hold('SCRAM_INPUT_INVALID');
  }
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(clientKey).digest('base64');
  const server = createHmac('sha256', salted)
    .update('Server Key')
    .digest('base64');
  return 'SCRAM-SHA-256$4096:' + salt.toString('base64') + '$' + stored + ':' + server;
}

function connectionOptions(urlText, ca) {
  const route = new URL(urlText);
  return {
    host: route.hostname,
    port: Number(route.port),
    database: 'postgres',
    user: decodeURIComponent(route.username),
    password: decodeURIComponent(route.password),
    ssl: { ca, rejectUnauthorized: true, servername: route.hostname },
    connectionTimeoutMillis: 8000,
    query_timeout: 8000,
    statement_timeout: 5000,
    application_name: 'novelight-formal-staging-ro-provision'
  };
}

async function verifyTls(client) {
  const result = await client.query(
    'select ssl from pg_catalog.pg_stat_ssl where pid=pg_backend_pid()'
  );
  if (result.rows.length !== 1 || result.rows[0].ssl !== true) {
    hold('TLS_NOT_VERIFIED');
  }
}

async function verifyDormantRole(client) {
  const result = await client.query(
    'select rolcanlogin,rolsuper,rolbypassrls,rolinherit ' +
      "from pg_catalog.pg_roles where rolname='novelight_formal_reader_ro'"
  );
  const r = result.rows[0];
  if (
    result.rows.length !== 1 ||
    r.rolcanlogin !== false ||
    r.rolsuper !== false ||
    r.rolbypassrls !== false ||
    r.rolinherit !== false
  ) {
    hold('ROLE_NOT_DORMANT_OR_UNSAFE');
  }
  for (const [schema, table, subjectColumn] of SOURCE_TABLES) {
    const relation = schema + '.' + table;
    const meta = await client.query(
      'select c.relrowsecurity as rls, ' +
        "has_column_privilege($1,c.oid,$2,'SELECT') as column_select, " +
        "has_table_privilege($1,c.oid,'SELECT') as broad_select, " +
        "has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE') as can_write, " +
        'exists(select 1 from pg_catalog.pg_policies p where p.schemaname=$3 ' +
        "and p.tablename=$4 and $1=any(p.roles) and p.cmd='SELECT') as policy " +
        'from pg_catalog.pg_class c join pg_catalog.pg_namespace n ' +
        'on n.oid=c.relnamespace where n.nspname=$3 and c.relname=$4',
      [ROLE, subjectColumn, schema, table]
    );
    const m = meta.rows[0];
    if (
      meta.rows.length !== 1 ||
      m.rls !== true ||
      m.column_select !== true ||
      m.broad_select !== false ||
      m.can_write !== false ||
      m.policy !== true
    ) {
      hold('STAGING_READER_ACL_DRIFT');
    }
    if (!relation) hold('INVALID_RELATION');
  }
}

async function fetchEnvInventory(token, fetchImpl) {
  const url = new URL(
    '/v10/projects/' + encodeURIComponent(PROJECT) + '/env',
    'https://api.vercel.com'
  );
  url.searchParams.set('teamId', TEAM);
  url.searchParams.set('gitBranch', BRANCH);
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) hold('VERCEL_INVENTORY_UNAVAILABLE');
  const payload = await res.json();
  if (!Array.isArray(payload.envs) || payload.pagination?.next != null) {
    hold('VERCEL_INVENTORY_INCOMPLETE');
  }
  return payload.envs.filter((v) => v.key === ENV_KEY && v.gitBranch === BRANCH);
}

async function storeBranchOnlySecret(token, connectionUrl, fetchImpl) {
  const url = new URL(
    '/v10/projects/' + encodeURIComponent(PROJECT) + '/env',
    'https://api.vercel.com'
  );
  url.searchParams.set('teamId', TEAM);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      {
        key: ENV_KEY,
        value: connectionUrl,
        type: 'sensitive',
        target: ['preview'],
        gitBranch: BRANCH,
        comment: 'NOVELIGHT formal reader Staging-only credentials; separate activation approval required'
      }
    ]),
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  });
  // Do not inspect or echo the response body: the server may reflect secrets.
  if (!res.ok) hold('VERCEL_SECRET_WRITE_UNVERIFIED');
}

async function verifyNewRole(client) {
  await verifyTls(client);
  const info = await client.query(
    'select current_user as role, current_setting($1) as read_only',
    ['default_transaction_read_only']
  );
  if (
    info.rows.length !== 1 ||
    info.rows[0].role !== ROLE ||
    info.rows[0].read_only !== 'on'
  ) {
    hold('READONLY_LOGIN_NOT_VERIFIED');
  }
}

export async function provisionFormalStagingReader({
  env = process.env,
  fetchImpl = globalThis.fetch,
  resolveScope = resolveVercelProjectScope,
  ClientImpl = Client
} = {}) {
  verifyFormalReaderProvisionContext(env);
  const ca = readFileSync(OFFICIAL_SUPABASE_CA_FILE_PATH, 'utf8');
  verifyPinnedSupabaseRootCa(ca);
  const scope = await resolveScope({
    fetchImpl,
    token: env.VERCEL_API_TOKEN,
    project: 'novelrise'
  });
  if (scope.projectId !== PROJECT || scope.teamId !== TEAM) {
    hold('VERCEL_PROJECT_IDENTITY_MISMATCH');
  }
  if ((await fetchEnvInventory(env.VERCEL_API_TOKEN, fetchImpl)).length !== 0) {
    hold('VERCEL_EXISTING_SECRET_REFUSED');
  }
  const admin = new ClientImpl(connectionOptions(env.STAGING_DATABASE_URL, ca));
  let loginActivated = false;
  try {
    await admin.connect();
    await verifyTls(admin);
    const who = await admin.query('select current_user as name');
    if (who.rows[0]?.name !== 'postgres') hold('PRIVILEGED_STAGING_ROLE_UNVERIFIED');
    await verifyDormantRole(admin);

    // Generate only in this trusted runner. Never echo the password or hash.
    const password = randomBytes(48).toString('base64url');
    const verifier = makeScramVerifier(password, randomBytes(16));
    const readerUrl = deriveFormalReaderDatabaseUrl(
      env.STAGING_DATABASE_URL,
      password
    );
    // A password is set while the role remains NOLOGIN: a failed Vercel
    // write cannot produce a publicly usable partial credential.
    await admin.query('ALTER ROLE ' + ROLE + " PASSWORD '" + verifier + "'");
    await storeBranchOnlySecret(env.VERCEL_API_TOKEN, readerUrl, fetchImpl);
    const created = await fetchEnvInventory(env.VERCEL_API_TOKEN, fetchImpl);
    if (
      created.length !== 1 ||
      created[0].type !== 'sensitive' ||
      created[0].target?.length !== 1 ||
      created[0].target[0] !== 'preview'
    ) {
      hold('VERCEL_POSTWRITE_METADATA_UNVERIFIED');
    }
    // Authorization is still OFF: only the isolated reader login is enabled.
    await admin.query('ALTER ROLE ' + ROLE + ' LOGIN');
    loginActivated = true;
    const reader = new ClientImpl(connectionOptions(readerUrl, ca));
    try {
      await reader.connect();
      await verifyNewRole(reader);
    } finally {
      await reader.end().catch(() => {});
    }
    return Object.freeze({
      status: 'staging_reader_credential_verified',
      projectRef: STAGING_REF,
      environment: 'preview_branch_only',
      formalRewardsEnabled: false
    });
  } catch {
    if (loginActivated) {
      // Do not silently claim a safe rollback when disabling login failed.
      let disabled = false;
      try {
        await admin.query('ALTER ROLE ' + ROLE + ' NOLOGIN');
        disabled = true;
      } catch {
        // A credential may still be active: require explicit operator review.
      }
      if (!disabled) hold('ROLE_DISABLE_UNVERIFIED');
    }
    hold('PROVISION_FAILED_SAFE_REVIEW_REQUIRED');
  } finally {
    await admin.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  provisionFormalStagingReader()
    .then(() => console.log('FORMAL_RO_STAGING_CREDENTIAL_READY'))
    .catch(() => {
      console.error('FORMAL_RO_STAGING_PROVISION_STOPPED');
      process.exitCode = 1;
    });
}
