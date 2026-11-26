// Recovery-only adapters. No I/O at import/construction. Existing STOP RPC
// and Auth global sign-out/session-exists RPC only. Credentials must be
// separately approved and supplied by the trusted recovery bootstrap.
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + PROJECT + '.supabase.co';
const ROLE = 'novelight_gatea_stop';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function deny() { throw new Error('AI_020705_INDEPENDENT_STOP_PORT_NO_GO'); }
const STOP_RPC = 'gatea_stop_private.stop_once()';
const ROLE_SQL = `
select current_user = 'novelight_gatea_stop' and session_user = current_user
 and rolcanlogin and not rolinherit
 and not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
 and not exists(select 1 from pg_catalog.pg_auth_members where member=r.oid)
 and pg_catalog.has_function_privilege(current_user,'gatea_stop_private.stop_once()','EXECUTE')
 and not exists (
  select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema')
   and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
   and c.relkind in ('r','p','v','m','f')
   and pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE')
   and (c.relowner=r.oid or
    pg_catalog.has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')
    or pg_catalog.has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES'))
 ) and not exists (
  select 1 from pg_catalog.pg_namespace n
  where n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
   and pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE')
 ) and not pg_catalog.has_database_privilege(current_user,current_database(),'CREATE')
 and not exists (
  select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind='S' and pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE')
   and pg_catalog.has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')
 ) and not exists (
  select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
   and p.oid <> pg_catalog.to_regprocedure('gatea_stop_private.stop_once()')
   and pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE')
   and pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
 ) as ok
from pg_catalog.pg_roles r where rolname=current_user
`;
const READBACK = `select singleton,enabled,user_day_cap_micros,user_month_cap_micros,
 global_day_cap_micros,global_month_cap_micros
 from public.novelight_ai_runtime_settings where singleton=1`;

export function validate020705StopUrl(value) {
  try {
    const u = new globalThis.URL(value);
    const direct = u.hostname === 'db.' + PROJECT + '.supabase.co' && u.username === ROLE;
    const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(u.hostname) &&
      u.username === ROLE + '.' + PROJECT;
    if (!['postgres:', 'postgresql:'].includes(u.protocol) ||
      !(direct || pooled) || u.port !== '5432' || u.pathname !== '/postgres' ||
      !u.password || u.search || u.hash) deny();
    return true;
  } catch { deny(); }
}

export function create020705IndependentStopRpc({ connectionString, scope } = {}) {
  validate020705StopUrl(connectionString);
  if (scope?.repository !== 'bingohooah888-ai/novelrise' ||
      scope?.stagingProjectRef !== PROJECT) deny();
  let attempted = false;
  return async function stopRuntime() {
    if (attempted) deny();
    attempted = true;
    let client;
    try {
      const { Client } = await import('pg');
      client = new Client({ connectionString, ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 5000, query_timeout: 10000 });
      await client.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const role = await client.query(ROLE_SQL);
      // The current net PUBLIC privileges are expected to deny here.
      // Never weaken this check or reuse a broad credential to force STOP.
      if (role.rows?.length !== 1 || role.rows[0].ok !== true) deny();
      await client.query('SELECT ' + STOP_RPC);
      await client.query('COMMIT');
      const check = await client.query(READBACK);
      return { count: check.rowCount, data: check.rows[0], error: null };
    } catch {
      if (client) { try { await client.query('ROLLBACK'); } catch {} }
      deny();
    } finally {
      if (client) { try { await client.end(); } catch { deny(); } }
    }
  };
}

// Revoke only the exact pre-provisioned synthetic user's globally scoped
// sessions. JWT must have been independently retained before runner death.
// Sign-out is not proof that a stateless JWT is unusable everywhere; require
// the existing session-exists RPC and the signed application denial proof.
export function create020705IndependentSessionRevoker({ scope, serviceClient, authAdmin, jwt, sessionId } = {}) {
  if (scope?.stagingProjectRef !== PROJECT || !UUID.test(scope.actorId ?? '') ||
      serviceClient?.supabaseUrl !== URL || authAdmin !== serviceClient?.auth?.admin ||
      typeof serviceClient.auth?.getClaims !== 'function' ||
      typeof authAdmin?.signOut !== 'function' || typeof serviceClient.rpc !== 'function' ||
      typeof jwt !== 'string' || jwt.length < 60 || jwt.length > 8192 ||
      !UUID.test(sessionId ?? '')) deny();
  const actor = scope.actorId;
  const args = Object.freeze({ p_actor_id: actor, p_session_id: sessionId });
  let attempted = false;
  return async function revokeSyntheticSessions(id) {
    if (attempted || id !== actor) deny();
    attempted = true;
    try {
      const checked = await authAdmin.getUserById(actor);
      const user = checked?.data?.user;
      if (checked?.error || user?.id !== actor ||
          user?.app_metadata?.internal_e2e !== true ||
          !user.email?.startsWith('novelight-ai-020705-')) deny();
      const claims = await serviceClient.auth.getClaims(jwt);
      if (claims?.error || claims?.data?.claims?.sub !== actor ||
          claims?.data?.claims?.session_id !== sessionId ||
          claims?.data?.claims?.iss !== URL + '/auth/v1') deny();
      const active = await serviceClient.rpc('novelight_ai_owner_session_exists_v1', args);
      if (active?.error || active?.data !== true) deny();
      const logout = await authAdmin.signOut(jwt, 'global');
      if (logout?.error) deny();
      const revoked = await serviceClient.rpc('novelight_ai_owner_session_exists_v1', args);
      if (revoked?.error || revoked?.data !== false) deny();
      return true;
    } catch { deny(); }
  };
}


// Fixed Data API transport for the preventive SQL proposal. The JWT payload
// check only rejects wrong credentials locally; Supabase MUST verify the
// signature/role. No PAT, service key, raw SQL, redirects or fallback.
// prettier-ignore
export function create020705PreventiveRpc({
  purpose, publishableKey, accessToken, principalId, fetchImpl = globalThis.fetch
} = {}) {
  const operations = Object.freeze({
    stop: ['novelight_gatea_stop', 'novelight_gatea_stop_v1'],
    census: ['novelight_gatea_census', 'novelight_gatea_census_v1']
  });
  const operation = Object.hasOwn(operations, purpose) ? operations[purpose] : null;
  if (!operation || !UUID.test(principalId ?? '') ||
      typeof publishableKey !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]{16,512}$/u.test(publishableKey) ||
      typeof accessToken !== 'string' || accessToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(accessToken) ||
      typeof fetchImpl !== 'function') deny();
  function validateClaims() {
    try {
      const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.iss !== URL + '/auth/v1' || payload.role !== operation[0] ||
          payload.sub !== principalId || !Number.isSafeInteger(payload.exp) ||
          payload.exp <= now || payload.exp > now + 3600) deny();
    } catch { deny(); }
  }
  validateClaims();
  return async function fixedRpc() {
    validateClaims();
    try {
      const response = await fetchImpl(URL + '/rest/v1/rpc/' + operation[1], {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          apikey: publishableKey,
          authorization: 'Bearer ' + accessToken,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: '{}'
      });
      if (response?.status !== 200 ||
          !/^application\/json(?:\s*;|$)/iu.test(response.headers?.get('content-type') ?? '')) deny();
      const raw = await response.text();
      if (raw.length > 8192) deny();
      return JSON.parse(raw);
    } catch { deny(); }
  };
}

// This is an explicit alternative port, not a replacement for live authority
// checks. The independently credentialed census must still verify the result.
// prettier-ignore
export function create020705PreventiveStopRpc(options = {}) {
  const call = create020705PreventiveRpc({ ...options, purpose: 'stop' });
  let attempted = false;
  return async function stopRuntime() {
    if (attempted) deny();
    attempted = true;
    const result = await call();
    const row = result?.data;
    const caps = ['user_day_cap_micros', 'user_month_cap_micros',
      'global_day_cap_micros', 'global_month_cap_micros'];
    if (Object.keys(result ?? {}).length !== 2 || result.count !== 1 ||
        Object.keys(row ?? {}).length !== 6 || row.singleton !== 1 ||
        row.enabled !== false || caps.some((key) => row[key] !== 0)) deny();
    return { count: result.count, data: row, error: null };
  };
}
