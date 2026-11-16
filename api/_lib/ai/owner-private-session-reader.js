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
