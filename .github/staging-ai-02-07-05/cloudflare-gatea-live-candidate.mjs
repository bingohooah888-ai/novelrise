// SOURCE CANDIDATE ONLY: existing Cloudflare Worker / SQLite DO class.
// Original 2026-11-03 A1 files remain unchanged and hash-pinned in the S2 ZIP.
// NOT deployed, no route, trigger, secret, arm, paid call or Staging side effect.
// Only an independently authorized Cloudflare service binding may invoke DO RPC.
const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const WORKFLOW = '.github/workflows/ai-020705-owner-staging-paid-trial.yml';
const OWNER = 'bingohooah888-ai';
const DOMAIN_ARM = 'NOVELIGHT_AI_020705_OWNER_ARM_V1';
const DOMAIN_BEAT = 'NOVELIGHT_AI_020705_RUNNER_HEARTBEAT_V1';
const DOMAIN_DEATH = 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1';
const NAME = /^[A-Za-z0-9_-]{8,64}$/u;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const FIELDS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
function deny() { throw new Error('AI_020705_CLOUDFLARE_LIVE_NO_GO'); }
function validScope(s) {
  return s?.repository === REPO && s?.stagingProjectRef === PROJECT &&
    SHA.test(s?.mainSha ?? '') && /^dpl_[A-Za-z0-9]+$/u.test(s?.previewDeploymentId ?? '') &&
    UUID.test(s?.actorId ?? '') &&
    ['novelId', 'episodeId', 'runId', 'approvalCommentId'].every((k) => positive(s?.[k])) &&
    Object.keys(s).length === FIELDS.length && FIELDS.every((k) => Object.hasOwn(s, k));
}
function decode64(input) {
  if (typeof input !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(input) ||
      input.length > 8192) deny();
  const bytes = atob(input);
  return Uint8Array.from(bytes, (c) => c.charCodeAt(0));
}
function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
// Signatures originate from separately pinned keys, never from a caller's
// claim of verifiedReadOnly / verifiedSynthetic / owner. Reject unknown key IDs.
export async function verify020705CloudflareSignature({
  domain, payload, signature, pinnedSpkiBase64, cryptoImpl = globalThis.crypto
} = {}) {
  try {
    if (![DOMAIN_ARM, DOMAIN_BEAT].includes(domain) ||
        !/^[A-Za-z0-9_-]{86}$/u.test(signature ?? '') ||
        !cryptoImpl?.subtle) return false;
    const key = await cryptoImpl.subtle.importKey(
      'spki', decode64(pinnedSpkiBase64), { name: 'Ed25519' }, false, ['verify']
    );
    const bytes = Uint8Array.from(atob(
      signature.replace(/-/gu, '+').replace(/_/gu, '/') + '=='
    ), (c) => c.charCodeAt(0));
    return bytes.length === 64 && await cryptoImpl.subtle.verify(
      { name: 'Ed25519' }, key, bytes,
      new TextEncoder().encode(JSON.stringify([domain, payload]))
    );
  } catch { return false; }
}
export async function inspect020705CloudflareGithubExit({
  scope, readToken, fetchImpl = globalThis.fetch
} = {}) {
  if (!validScope(scope) || typeof fetchImpl !== 'function' ||
      typeof readToken !== 'string' || readToken.length < 16) deny();
  const base = 'https://api.github.com/repos/' + REPO + '/actions/runs/' + scope.runId;
  const options = {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + readToken,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };
  async function get(url) {
    const response = await fetchImpl(url, options);
    if (response?.ok !== true || response.status !== 200) deny();
    return response.json();
  }
  const run = await get(base);
  const jobs = await get(base + '/jobs?per_page=100');
  if (run?.id !== scope.runId || run?.head_sha !== scope.mainSha ||
      run?.head_branch !== 'main' || run?.path !== WORKFLOW ||
      run?.repository?.full_name !== REPO ||
      run?.actor?.login !== OWNER || run?.triggering_actor?.login !== OWNER ||
      run?.event !== 'workflow_dispatch' || run?.run_attempt !== 1 ||
      run?.status !== 'completed' ||
      !['failure', 'cancelled', 'timed_out'].includes(run.conclusion) ||
      jobs?.total_count < 1 || jobs.total_count > 100 ||
      !Array.isArray(jobs.jobs) || jobs.jobs.length !== jobs.total_count ||
      jobs.jobs.some((j) => j.status !== 'completed' || j.run_id !== scope.runId)) deny();
  return Object.freeze({
    runId: scope.runId, mainSha: scope.mainSha,
    status: 'completed', conclusion: run.conclusion,
    runAttempt: 1, independentGithubExitVerified: true
  });
}
async function sign020705Death({ proof, keyId, nonce, pkcs8, cryptoImpl }) {
  if (!NAME.test(keyId ?? '') || !NONCE.test(nonce ?? '') ||
      typeof pkcs8 !== 'string' || !cryptoImpl?.subtle) deny();
  const key = await cryptoImpl.subtle.importKey(
    'pkcs8', decode64(pkcs8), { name: 'Ed25519' }, false, ['sign']
  );
  const signature = await cryptoImpl.subtle.sign(
    { name: 'Ed25519' }, key,
    new TextEncoder().encode(JSON.stringify([DOMAIN_DEATH, keyId, nonce, proof]))
  );
  return Object.freeze({
    domain: DOMAIN_DEATH, keyId, challengeNonce: nonce,
    proof, signature: b64url(signature)
  });
}

// The class name is deliberately identical to the existing A1 binding.
// Deploying this CANDIDATE would REPLACE the existing class implementation;
// that is not authorized in this turn. No new Worker / DO is defined.
export class GateAWatchdogDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  check() {
    if (this.env?.GATEA_LIVE_ENABLED !== 'true' ||
        typeof this.env?.GATEA_OWNER_PUB_SPKI !== 'string' ||
        typeof this.env?.GATEA_RUNNER_PUB_SPKI !== 'string' ||
        typeof this.env?.GATEA_CONTROLLER_PRIVATE_PKCS8 !== 'string' ||
        typeof this.env?.GATEA_GITHUB_ACTIONS_READ_TOKEN !== 'string' ||
        typeof this.ctx?.storage?.transactionSync !== 'function' ||
        typeof this.ctx.storage.sql?.exec !== 'function' ||
        typeof this.ctx.storage.setAlarm !== 'function') deny();
  }
  init() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS gatea_live_once (' +
        ' id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL,' +
        ' nonce TEXT NOT NULL, controller_run_id INTEGER NOT NULL,' +
        ' deadline_ms INTEGER NOT NULL, heartbeat_ms INTEGER NOT NULL,' +
        ' receipt TEXT,' +
        ' state TEXT NOT NULL CHECK(state IN ' +
        " ('WATCHING','CLAIMED','STOPPED','FAILED_CLOSED'))) "
      );
    });
  }
  row() {
    return this.ctx.storage.sql.exec(
      'SELECT scope,nonce,controller_run_id,deadline_ms,heartbeat_ms,state ' +
      ' ,receipt FROM gatea_live_once WHERE id=1'
    ).toArray()[0] ?? null;
  }
  async arm({ scope, nonce, controllerRunId, expiresAtMs, signature } = {}) {
    this.check();
    const now = Date.now();
    if (!validScope(scope) || !NONCE.test(nonce ?? '') ||
        !positive(controllerRunId) || controllerRunId === scope.runId ||
        !positive(expiresAtMs) || expiresAtMs <= now ||
        expiresAtMs - now > 60000 ||
        !await verify020705CloudflareSignature({
          domain: DOMAIN_ARM,
          payload: { scope, nonce, controllerRunId, expiresAtMs },
          signature, pinnedSpkiBase64: this.env.GATEA_OWNER_PUB_SPKI
        })) deny();
    this.init();
    const deadline = Math.min(now + 15000, expiresAtMs);
    this.ctx.storage.transactionSync(() => {
      if (this.row()) deny();
      this.ctx.storage.sql.exec(
        'INSERT INTO gatea_live_once VALUES(1,?,?,?,?,?,?,?)',
        JSON.stringify(FIELDS.map((k) => scope[k])),
        nonce, controllerRunId, deadline, 0, null, 'WATCHING'
      );
    });
    try { await this.ctx.storage.setAlarm(deadline); }
    catch {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE gatea_live_once SET state='FAILED_CLOSED' WHERE id=1"
        );
      });
      deny();
    }
    return Object.freeze({ state: 'WATCHING', authorizesPaidCall: false });
  }
  async heartbeat({ scope, nonce, heartbeatMs, signature } = {}) {
    this.check();
    if (!validScope(scope) || !NONCE.test(nonce ?? '') ||
        !positive(heartbeatMs) || heartbeatMs > Date.now() ||
        Date.now() - heartbeatMs > 15000 ||
        !await verify020705CloudflareSignature({
          domain: DOMAIN_BEAT, payload: { scope, nonce, heartbeatMs },
          signature, pinnedSpkiBase64: this.env.GATEA_RUNNER_PUB_SPKI
        })) deny();
    let deadline;
    this.ctx.storage.transactionSync(() => {
      const current = this.row();
      if (!current || current.state !== 'WATCHING' ||
          current.scope !== JSON.stringify(FIELDS.map((k) => scope[k])) ||
          current.nonce !== nonce || heartbeatMs <= current.heartbeat_ms) deny();
      deadline = Math.min(heartbeatMs + 15000, current.deadline_ms + 15000);
      this.ctx.storage.sql.exec(
        'UPDATE gatea_live_once SET heartbeat_ms=?,deadline_ms=? WHERE id=1',
        heartbeatMs, deadline
      );
    });
    try { await this.ctx.storage.setAlarm(deadline); } catch { deny(); }
    return Object.freeze({ state: 'WATCHING', authorizesPaidCall: false });
  }
  // Alarm lives in this independent Cloudflare DO, not in the paid Runner.
  // An expired heartbeat alone NEVER authorizes a mutation or death report.
  async alarm() {
    this.check();
    const current = this.row();
    if (!current || current.state !== 'WATCHING') return;
    const now = Date.now();
    if (now < current.deadline_ms) {
      await this.ctx.storage.setAlarm(current.deadline_ms);
      return;
    }
    const scopeValues = JSON.parse(current.scope);
    const scope = Object.fromEntries(FIELDS.map((key, i) => [key, scopeValues[i]]));
    let exit;
    try {
      exit = await inspect020705CloudflareGithubExit({
        scope, readToken: this.env.GATEA_GITHUB_ACTIONS_READ_TOKEN
      });
    } catch {
      // No independent terminal Github evidence: NO-GO and no recovery.
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE gatea_live_once SET state='FAILED_CLOSED' WHERE id=1 AND state='WATCHING'"
        );
      });
      return;
    }
    if (exit.independentGithubExitVerified !== true ||
        current.heartbeat_ms === 0 ||
        now - current.heartbeat_ms < 250 ||
        now - current.heartbeat_ms > 15000) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE gatea_live_once SET state='FAILED_CLOSED' WHERE id=1 AND state='WATCHING'"
        );
      });
      return;
    }
    // Exactly ONE recovery round; duplicates, alarm retries and replays inert.
    this.ctx.storage.transactionSync(() => {
      if (this.row()?.state !== 'WATCHING') deny();
      this.ctx.storage.sql.exec(
        "UPDATE gatea_live_once SET state='CLAIMED' WHERE id=1 AND state='WATCHING'"
      );
    });
    const proof = {
      ...scope,
      kind: 'detached-controller-runner-death',
      runnerConfirmedDead: true,
      controllerIsRunner: false,
      controllerRunId: current.controller_run_id,
      observedAtMs: now,
      runnerHeartbeatAtMs: current.heartbeat_ms,
      expiresAtMs: now + 10000
    };
    // Never persist key, raw GitHub response, JWT or story content.
    const envelope = await sign020705Death({
      proof, keyId: this.env.GATEA_CONTROLLER_KEY_ID,
      nonce: current.nonce, pkcs8: this.env.GATEA_CONTROLLER_PRIVATE_PKCS8,
      cryptoImpl: globalThis.crypto
    });
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE gatea_live_once SET receipt=? WHERE id=1 AND state='CLAIMED'",
        JSON.stringify(envelope)
      );
    });
    return Object.freeze({ state: 'CLAIMED', noPaidRetry: true });
  }
  async readReceipt({ scope, nonce, signature } = {}) {
    this.check();
    if (!validScope(scope) || !NONCE.test(nonce ?? '') ||
        !await verify020705CloudflareSignature({
          domain: DOMAIN_ARM,
          payload: { scope, nonce, readOnlyReceipt: true },
          signature, pinnedSpkiBase64: this.env.GATEA_OWNER_PUB_SPKI
        })) deny();
    const current = this.row();
    if (current?.state !== 'CLAIMED' || current.nonce !== nonce ||
        current.scope !== JSON.stringify(FIELDS.map((k) => scope[k])) ||
        typeof current.receipt !== 'string') deny();
    return Object.freeze({ envelope: JSON.parse(current.receipt),
      authorizesMutation: false, authorizesPaidCall: false });
  }
  async fetch() {
    // Explicitly no public admission, even after code deployment.
    return new Response(null, {
      status: 404, headers: { 'cache-control': 'no-store' }
    });
  }
}

// Dormant: enabling an authenticated route and GATEA_HTTP_ADMISSION_ENABLED
// requires separate OWNER approval. No routing/trigger change in this PR.
export default Object.freeze({
  async fetch(request, env) {
    const rejected = () => new Response(null, {
      status: 404, headers: { 'cache-control': 'no-store' }
    });
    if (env?.GATEA_LIVE_ENABLED !== 'true' ||
        env?.GATEA_HTTP_ADMISSION_ENABLED !== 'true' ||
        request?.method !== 'POST' ||
        typeof env?.GATEA_WATCHDOG?.idFromName !== 'function' ||
        typeof env?.GATEA_WATCHDOG?.get !== 'function') return rejected();
    const path = new URL(request.url).pathname;
    const operation = {
      '/_novelight/gatea/arm': 'arm',
      '/_novelight/gatea/heartbeat': 'heartbeat',
      '/_novelight/gatea/receipt': 'readReceipt'
    }[path];
    if (!operation) return rejected();
    try {
      const length = Number(request.headers.get('content-length'));
      if (Number.isFinite(length) && length > 4096) return rejected();
      const text = await request.text();
      if (text.length > 4096) return rejected();
      const input = JSON.parse(text);
      if (!validScope(input?.scope) || !NONCE.test(input?.nonce ?? '')) {
        return rejected();
      }
      const id = env.GATEA_WATCHDOG.idFromName('ai-020705-' + input.scope.runId);
      const stub = env.GATEA_WATCHDOG.get(id);
      const method = stub?.[operation];
      if (typeof method !== 'function') return rejected();
      // DO checks a pinned Ed25519 owner or runner signature *before* any
      // mutation or receipt disclosure. No unsigned/status/debug endpoint.
      const result = await method.call(stub, input);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    } catch {
      return rejected();
    }
  }
});
