// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import { randomBytes } from 'node:crypto';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import { create020705PrivateDoClaimPort } from '../.github/staging-ai-02-07-05/gatea-controller-do-claim-port-candidate.mjs';
// prettier-ignore
import { sign020705PrivateDoClaim } from '../.github/staging-ai-02-07-05/gatea-private-claim-auth-candidate.mjs';
// prettier-ignore
import { handle020705PrivateDoClaimFetch } from '../.github/staging-ai-02-07-05/gatea-private-claim-fetch-handler-candidate.mjs';
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise', stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40), previewDeploymentId: 'dpl_test123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 100, episodeId: 200, runId: 300, approvalCommentId: 400
});
// prettier-ignore
const now = Date.parse('2026-11-18T10:30:00Z');
// prettier-ignore
const nonce = 'N'.repeat(44);
// prettier-ignore
const secret = randomBytes(32).toString('base64url');
// prettier-ignore
const flags = Object.freeze({
  GATEA_LIVE_ENABLED: 'true', GATEA_RECOVERY_DISPATCH_ENABLED: 'true',
  GATEA_CLAIM_LEDGER_ENABLED: 'true', GATEA_CLAIM_HMAC_KEY: secret
});
// prettier-ignore
test('private DO fetch HMAC claims the existing WATCHING run once', async () => {
  const keys = new Set();
  let ready = 0;
  let inTx = false;
  const storage = {
    transactionSync(fn) { inTx = true; try { return fn(); }
      finally { inTx = false; } },
    sql: { exec(query, kind, key) {
      assert.equal(inTx, true);
      if (query.startsWith('CREATE TABLE')) return { rowsWritten: 0 };
      const pk = kind + key;
      if (keys.has(pk)) return { rowsWritten: 0 };
      keys.add(pk); return { rowsWritten: 1 };
    } }
  };
  const fields = ['repository','stagingProjectRef','mainSha','previewDeploymentId',
    'actorId','novelId','episodeId','runId','approvalCommentId'];
  const row = {
    scope: JSON.stringify(fields.map((k) => scope[k])), nonce,
    controller_run_id: 301, state: 'WATCHING', receipt: null
  };
  const namespace = {
    idFromName(name) { assert.equal(name, 'ai-020705-300'); return name; },
    get() { return { fetch: (request) => handle020705PrivateDoClaimFetch({
      request, env: flags, storage,
      readCurrent: () => { assert.equal(inTx, true); return row; },
      ensureWatchdogReady: () => { ready += 1; }, now: () => now
    }) }; }
  };
  const port = create020705PrivateDoClaimPort({
    namespace, scope, controllerRunId: 301,
    hmacSecret: secret, now: () => now
  });
  assert.equal(await port.claimArmOnce({ scope, nonce, controllerRunId: 301 }), true);
  await assert.rejects(port.claimArmOnce({ scope, nonce, controllerRunId: 301 }),
    /PRIVATE_CLAIM_BINDING_NO_GO/u);
  assert.equal(ready, 2);
  assert.equal(keys.size, 1);
});
// prettier-ignore
test('wrong HMAC, disabled DO or stale proof never claims', async () => {
  const proof = await sign020705PrivateDoClaim({
    kind: 'ARM', scope, nonce, controllerRunId: 301, secret,
    now: () => now
  });
  const invoke = (payload, env = flags, time = now) =>
    handle020705PrivateDoClaimFetch({
      request: new globalThis.Request('https://gatea-do.internal/_novelight/gatea/claim', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }), env, storage: { transactionSync() { throw new Error('must not write'); } },
      ensureWatchdogReady() { throw new Error('must not run'); },
      now: () => time
    });
  assert.equal((await invoke({ ...proof, mac: 'A'.repeat(43) })).status, 404);
  assert.equal((await invoke(proof, { ...flags, GATEA_CLAIM_LEDGER_ENABLED: 'false' })).status, 404);
  assert.equal((await invoke(proof, flags, now + 11000)).status, 404);
});
