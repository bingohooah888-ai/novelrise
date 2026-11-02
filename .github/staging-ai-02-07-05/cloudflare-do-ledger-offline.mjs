// NOVELIGHT AI 02-07-05 — Cloudflare SQLite-backed Durable Object ledger DRILL.
// OFFLINE SYNTHETIC ONLY: no Worker export, route, alarm, network, credentials,
// Staging/Production access, runtime kill, or paid-model authorization.
// This is storage-level atomicity rehearsal, NOT a deployed controller.
const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const SHA = /^[0-9a-f]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const MAX_ROUNDS = 3; // Synthetic drill cap; NOT an approved live policy.
const SCOPE_KEYS = Object.freeze([
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
]);
const ARM = 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1';
const RECOVERY = 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1';

function deny() {
  throw new Error('AI_020705_CLOUDFLARE_LEDGER_OFFLINE_DENIED');
}
function scopeKey(scope) {
  if (scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGING ||
      !SHA.test(scope?.mainSha ?? '') ||
      !DEPLOYMENT.test(scope?.previewDeploymentId ?? '') ||
      !UUID.test(scope?.actorId ?? '') ||
      !['novelId', 'episodeId', 'runId', 'approvalCommentId'].every(
        (name) => Number.isSafeInteger(scope?.[name]) && scope[name] > 0
      )) deny();
  // Canonical, secret-free encoding; never derive from untrusted JSON order.
  return JSON.stringify(SCOPE_KEYS.map((key) => scope[key]));
}
function rows(cursor) {
  if (!cursor || typeof cursor.toArray !== 'function') deny();
  return cursor.toArray();
}
function success() {
  return Object.freeze({
    status: 'SYNTHETIC_ONLY',
    authorizesPaidCall: false,
    authorizesMutation: false,
    authorizesWorkerDeployment: false
  });
}

/**
 * Exactly the storage API provided by SQLite-backed Durable Objects:
 * ctx.storage.sql.exec(...) and ctx.storage.transactionSync(() => ...).
 * No imported Cloudflare runtime code, no registration or binding.
 * Caller must externally verify OWNER approval, signed challenge, key source,
 * paid one-shot tombstone and runner death: these are not authenticated here.
 */
export function create020705CloudflareDoLedgerOffline({
  mode,
  storage,
  now = Date.now
} = {}) {
  if (mode !== 'offline-synthetic-only' ||
      typeof storage?.transactionSync !== 'function' ||
      typeof storage?.sql?.exec !== 'function' ||
      typeof now !== 'function') deny();
  const sql = storage.sql;
  // Explicit synthetic initialization; no side effects on import.
  function initialize() {
    return storage.transactionSync(() => {
      sql.exec(`CREATE TABLE IF NOT EXISTS gatea_arm_spent (
        scope_key TEXT NOT NULL,
        controller_key_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        consumed_ms INTEGER NOT NULL,
        PRIMARY KEY (scope_key, controller_key_id, nonce)
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS gatea_recovery_rounds (
        scope_key TEXT NOT NULL,
        round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
        fence INTEGER NOT NULL CHECK (fence > 0),
        nonce TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active','failed','complete')),
        started_ms INTEGER NOT NULL,
        ended_ms INTEGER,
        PRIMARY KEY (scope_key, round),
        UNIQUE (scope_key, fence),
        UNIQUE (scope_key, nonce)
      )`);
      return success();
    });
  }
  function consumeSyntheticArmOnce({scope, contract, controllerKeyId, nonce} = {}) {
    const key = scopeKey(scope);
    if (contract !== ARM || !KEY_ID.test(controllerKeyId ?? '') ||
        !NONCE.test(nonce ?? '')) deny();
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) deny();
    return storage.transactionSync(() => {
      sql.exec(`INSERT OR IGNORE INTO gatea_arm_spent
        (scope_key, controller_key_id, nonce, consumed_ms)
        VALUES (?, ?, ?, ?)`, key, controllerKeyId, nonce, timestamp);
      const result = rows(sql.exec('SELECT changes() AS written'));
      return result.length === 1 && result[0].written === 1;
    });
  }
  function beginSyntheticRecovery({
    scope, contract, nonce, checkedSignedDeathOffline,
    observedPaidTombstoneOffline
  } = {}) {
    const key = scopeKey(scope);
    if (contract !== RECOVERY || !NONCE.test(nonce ?? '') ||
        checkedSignedDeathOffline !== true ||
        observedPaidTombstoneOffline !== true) deny();
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) deny();
    return storage.transactionSync(() => {
      const last = rows(sql.exec(`SELECT round, fence, state FROM
        gatea_recovery_rounds WHERE scope_key = ? ORDER BY round DESC
        LIMIT 1`, key))[0];
      if (last && last.state !== 'failed') return null;
      const round = (last?.round ?? 0) + 1;
      if (round > MAX_ROUNDS) return null;
      const fence = (last?.fence ?? 0) + 1;
      sql.exec(`INSERT OR IGNORE INTO gatea_recovery_rounds
        (scope_key, round, fence, nonce, state, started_ms)
        VALUES (?, ?, ?, ?, 'active', ?)`, key, round, fence, nonce, timestamp);
      if (rows(sql.exec('SELECT changes() AS written'))[0]?.written !== 1)
        return null;
      return Object.freeze({...success(), round, fence});
    });
  }
  function settleSyntheticRecovery({scope, round, fence, nonce, state} = {}) {
    const key = scopeKey(scope);
    if (!Number.isSafeInteger(round) || round < 1 || round > MAX_ROUNDS ||
        !Number.isSafeInteger(fence) || fence < 1 ||
        !NONCE.test(nonce ?? '') ||
        !['failed', 'complete'].includes(state)) deny();
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) deny();
    return storage.transactionSync(() => {
      sql.exec(`UPDATE gatea_recovery_rounds SET state = ?, ended_ms = ?
        WHERE scope_key = ? AND round = ? AND fence = ? AND nonce = ?
        AND state = 'active'`, state, timestamp, key, round, fence, nonce);
      return rows(sql.exec('SELECT changes() AS written'))[0]?.written === 1;
    });
  }
  return Object.freeze({
    initialize,
    consumeSyntheticArmOnce,
    beginSyntheticRecovery,
    settleSyntheticRecovery
  });
}
