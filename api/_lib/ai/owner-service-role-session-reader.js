// OFFLINE-ONLY service-role session observer: no public route imports this.
// A separately approved SQL proposal will expose a backend-only INVOKER RPC,
// backed by a private restricted session guard. No direct Auth DB grants.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_RPC = 'novelight_ai_owner_session_exists_v1';

function uuid(value) {
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

// The CALLER must first verify the JWT signature, issuer, audience and
// subject. This lookup alone never proves token authenticity. No network
// call occurs until a trusted server invokes this function.
export function createOfflineServiceRoleSessionLookup({ serviceClient } = {}) {
  return async function lookupOneSession({ sessionId, actorId } = {}) {
    const session = uuid(sessionId);
    const owner = uuid(actorId);
    if (!session || !owner || typeof serviceClient?.rpc !== 'function') {
      return false;
    }
    try {
      const result = await serviceClient.rpc(SESSION_RPC, {
        p_session_id: session,
        p_actor_id: owner
      });
      if (result?.error !== null && result?.error !== undefined) {
        return false;
      }
      return result?.data === true;
    } catch {
      return false;
    }
  };
}
