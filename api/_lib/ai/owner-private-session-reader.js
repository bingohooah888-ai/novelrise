// AI phase 2: unmounted, offline-only server capability adapter.
// No DB client, SQL, RPC, public route or auth token is used in this module.
// A FUTURE server-side lookupOneSession MUST be an independently authorized,
// parameterized, read-only, one-row lookup: SELECT EXISTS for the exact
// auth.sessions.id + auth.sessions.user_id pair. It must return a primitive
// boolean, never rows, table listings, errors, secrets or JWTs.
// Do NOT expose the auth schema, use a public SECURITY DEFINER RPC, or grant
// anon/authenticated access to a privileged session-checking function.
//
// A successful boolean is an attestation from that future server capability;
// the synthetic {id,user_id} below is NOT a database result. The server
// capability's access restrictions, timing, session-expiration policy and
// transaction/race behavior remain unverified until separately approved.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value) {
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

// Dependency-injected, OFFLINE-ONLY bridge for a future separately authorized
// server-side PostgreSQL session observer. It never constructs a connection,
// accepts tokens or exposes private rows. The supplied server-owned PG client
// must already have the narrowly scoped auth.sessions SELECT privilege; the
// ordinary Supabase service_role does NOT have this in the observed Staging.
// Do not mount or provide credentials before independent environment approval.
// Parameter binding is mandatory; the signed session UUID is never interpolated.
const SESSION_EXISTS_SQL =
  'SELECT EXISTS (SELECT 1 FROM auth.sessions ' +
  'WHERE id = $1::uuid AND user_id = $2::uuid) AS active';

export function createOfflineReadOnlyAuthSessionLookup({ queryClient } = {}) {
  return async function lookupOneSession({ sessionId, actorId } = {}) {
    const session = uuid(sessionId);
    const owner = uuid(actorId);
    if (typeof queryClient?.query !== 'function' || !session || !owner) {
      return false;
    }

    try {
      const result = await queryClient.query(SESSION_EXISTS_SQL, [
        session,
        owner
      ]);
      const row = result?.rows?.[0];
      // Only an actual one-row SELECT returning the primitive PG boolean
      // can attest presence. A loose object, role error, unexpected row
      // shape or failed lookup never authorizes a signed session.
      return Boolean(
        result?.command === 'SELECT' &&
        result?.rowCount === 1 &&
        result.rows.length === 1 &&
        row &&
        Object.keys(row).length === 1 &&
        row.active === true
      );
    } catch {
      return false;
    }
  };
}

// Backend-only use with the staged SQL proposal's service-role INVOKER RPC.
// A private, non-exposed helper performs the actual auth.sessions lookup;
// no new direct PostgreSQL credentials or auth.sessions grants are required.
// This is only a capability factory. It never calls the network until invoked,
// and is NOT wired into public routes without separate Staging approval.
const SESSION_PROBE_RPC = 'novelight_ai_owner_session_exists_v1';

export function createOfflineServiceRoleSessionLookup({
  serviceClient
} = {}) {
  return async function lookupOneSession({ sessionId, actorId } = {}) {
    const session = uuid(sessionId);
    const owner = uuid(actorId);
    if (!session || !owner || typeof serviceClient?.rpc !== 'function') {
      return false;
    }
    try {
      const response = await serviceClient.rpc(SESSION_PROBE_RPC, {
        p_session_id: session,
        p_actor_id: owner
      });
      // Only the literal boolean true from the restricted RPC is accepted.
      // An error, absent proposal, unexpected data shape or permission denial
      // must block the owner workflow without revealing private auth metadata.
      return response?.error == null && response?.data === true;
    } catch {
      return false;
    }
  };
}

export function createOfflinePrivateSessionReader({ lookupOneSession } = {}) {
  return async function readExistingSession({ sessionId, actorId } = {}) {
    const id = uuid(sessionId);
    const owner = uuid(actorId);
    if (typeof lookupOneSession !== 'function' || !id || !owner) return null;

    try {
      // The dependency must execute as a narrowly privileged SERVER-ONLY
      // capability. "true" is valid only when this exact tuple exists.
      // Never coerce {exists:true}, a row object, or a nonboolean to truthy.
      const found = await lookupOneSession({
        sessionId: id,
        actorId: owner
      });
      if (found !== true) return null;

      // Compatibility with owner-session-evidence.js's established contract,
      // without ever returning real auth.sessions data to the caller.
      return Object.freeze({
        data: Object.freeze({ id, user_id: owner }),
        error: null
      });
    } catch {
      // No exception messages, identifiers or credentials are logged.
      return null;
    }
  };
}
