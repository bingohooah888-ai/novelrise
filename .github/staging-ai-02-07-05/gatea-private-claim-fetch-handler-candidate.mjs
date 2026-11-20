// CODE ONLY: the original DO's private fetch, NEVER the public Worker route.
import { verify020705PrivateDoClaim } from './gatea-private-claim-auth-candidate.mjs';
import { claim020705WithinExistingWatchdog } from './gatea-cloudflare-claim-rpc-candidate.mjs';
const PATH = '/_novelight/gatea/claim';
const HOST = 'gatea-do.internal';
function blocked() {
  return new Response(null, {
    status: 404, headers: { 'cache-control': 'no-store' }
  });
}
export async function handle020705PrivateDoClaimFetch({
  request, env, storage, readCurrent, ensureWatchdogReady,
  cryptoImpl = globalThis.crypto, now = Date.now
} = {}) {
  try {
    if (env?.GATEA_CLAIM_LEDGER_ENABLED !== 'true' ||
        env?.GATEA_LIVE_ENABLED !== 'true' ||
        env?.GATEA_RECOVERY_DISPATCH_ENABLED !== 'true' ||
        env?.GATEA_LOCAL_SYNTHETIC_ONLY === 'true' ||
        typeof ensureWatchdogReady !== 'function' ||
        request?.method !== 'POST' ||
        request.headers.get('content-type') !== 'application/json')
      return blocked();
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.hostname !== HOST ||
        url.pathname !== PATH || url.search !== '' || url.hash !== '')
      return blocked();
    const size = Number(request.headers.get('content-length'));
    if (Number.isFinite(size) && size > 2048) return blocked();
    const raw = await request.text();
    if (raw.length < 1 || raw.length > 2048) return blocked();
    const payload = JSON.parse(raw);
    if (!await verify020705PrivateDoClaim({
      payload, secret: env.GATEA_CLAIM_HMAC_KEY, cryptoImpl, now
    })) return blocked();
    ensureWatchdogReady();
    const result = claim020705WithinExistingWatchdog({
      storage, env, readCurrent, input: payload
    });
    return new Response(JSON.stringify(result), {
      status: 200, headers: {
        'content-type': 'application/json', 'cache-control': 'no-store'
      }
    });
  } catch { return blocked(); }
}
