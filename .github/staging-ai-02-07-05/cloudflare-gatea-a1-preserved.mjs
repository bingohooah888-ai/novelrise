// Gate A Cloudflare Durable Object: local synthetic-only implementation.
// No HTTP admission, secrets, provider calls, external stop, or Staging mutation.
// Alarm is a durable observation timer, NOT evidence of runner death.
import {create020705CloudflareDoLedgerOffline} from './cloudflare-do-ledger-offline.mjs';

const MODE = 'offline-synthetic-only';
const ARM = 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1';
const WATCHING = 'WATCHING_SYNTHETIC';
const EXPIRED = 'HEARTBEAT_EXPIRED_UNVERIFIED';
const UNSCHEDULED = 'ALARM_NOT_SCHEDULED';
const STOPPING = 'STOP_PENDING_SYNTHETIC';
const STOPPED = 'STOPPED_SYNTHETIC';
const CANCEL_FAILED = 'ALARM_CANCEL_FAILED_CLOSED';
const HEARTBEAT_LIMIT_MS = 15000;
const KEYS = Object.freeze([
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
]);

function deny() {
  throw new Error('AI_020705_CLOUDFLARE_WATCHDOG_LOCAL_DENIED');
}
function validTime(n) {
  return Number.isSafeInteger(n) && n > 0;
}
function rows(cursor) {
  if (!cursor || typeof cursor.toArray !== 'function') deny();
  return cursor.toArray();
}
function blocked() {
  return new Response(null, {
    status: 404, headers: {'cache-control': 'no-store'}
  });
}

export class GateAWatchdogDurableObject {
  constructor(ctx, env, clock = Date.now) {
    this.ctx = ctx;
    this.env = env;
    this.clock = clock;
    this.initialized = false;
  }

  // No externally callable command path, including on the DO itself.
  async fetch() {
    return blocked();
  }

  checkOffline() {
    if (this.env?.GATEA_LOCAL_SYNTHETIC_ONLY !== 'true' ||
        typeof this.clock !== 'function' ||
        typeof this.ctx?.storage?.transactionSync !== 'function' ||
        typeof this.ctx.storage.sql?.exec !== 'function' ||
        typeof this.ctx.storage.setAlarm !== 'function') deny();
  }

  currentTime() {
    const now = this.clock();
    if (!validTime(now)) deny();
    return now;
  }

  ledger() {
    return create020705CloudflareDoLedgerOffline({
      mode: MODE, storage: this.ctx.storage, now: this.clock
    });
  }

  initialize() {
    if (this.initialized) return;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec([
        'CREATE TABLE IF NOT EXISTS gatea_watchdog_local (',
        'id INTEGER PRIMARY KEY CHECK (id = 1),',
        'scope_key TEXT NOT NULL,',
        'last_observed_ms INTEGER NOT NULL,',
        'last_heartbeat_ms INTEGER NOT NULL,',
        'deadline_ms INTEGER NOT NULL,',
        'state TEXT NOT NULL CHECK (state IN',
        "('WATCHING_SYNTHETIC','HEARTBEAT_EXPIRED_UNVERIFIED','ALARM_NOT_SCHEDULED'," +
        "'STOP_PENDING_SYNTHETIC','STOPPED_SYNTHETIC','ALARM_CANCEL_FAILED_CLOSED'))",
        ')'
      ].join(' '));
    });
    this.initialized = true;
  }

  readRow() {
    return rows(this.ctx.storage.sql.exec(
      'SELECT scope_key, last_observed_ms, last_heartbeat_ms, deadline_ms, state ' +
      'FROM gatea_watchdog_local WHERE id = 1'
    ))[0] ?? null;
  }

  // Only local direct-invocation test code can call this method.
  // A future external admission API requires separate authentication approval.
  async armSynthetic({
    scope, controllerKeyId, challengeNonce, observedAtMs, heartbeatAtMs
  } = {}) {
    this.checkOffline();
    const now = this.currentTime();
    if (!validTime(observedAtMs) || !validTime(heartbeatAtMs) ||
        heartbeatAtMs > observedAtMs || observedAtMs > now ||
        now - observedAtMs > HEARTBEAT_LIMIT_MS ||
        now - heartbeatAtMs >= HEARTBEAT_LIMIT_MS) deny();

    const scopeKey = JSON.stringify(KEYS.map((name) => scope?.[name]));
    this.initialize();
    if (this.readRow()) deny(); // One active scope per DO. No replacement.
    const ledger = this.ledger();
    ledger.initialize();
    if (ledger.consumeSyntheticArmOnce({
      scope, contract: ARM, controllerKeyId, nonce: challengeNonce
    }) !== true) deny();

    const deadlineMs = heartbeatAtMs + HEARTBEAT_LIMIT_MS;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'INSERT INTO gatea_watchdog_local ' +
        '(id, scope_key, last_observed_ms, last_heartbeat_ms, deadline_ms, state) ' +
        'VALUES (1, ?, ?, ?, ?, ?)',
        scopeKey, observedAtMs, heartbeatAtMs, deadlineMs, WATCHING
      );
    });
    await this.scheduleOrFailClosed(deadlineMs);
    return this.statusSynthetic();
  }

  // Offline synthetic heartbeat, never treated as authenticated runner proof.
  async heartbeatSynthetic({scope, observedAtMs, heartbeatAtMs} = {}) {
    this.checkOffline();
    const now = this.currentTime();
    if (!validTime(observedAtMs) || !validTime(heartbeatAtMs) ||
        observedAtMs > now || heartbeatAtMs > observedAtMs ||
        now - observedAtMs > HEARTBEAT_LIMIT_MS ||
        now - heartbeatAtMs >= HEARTBEAT_LIMIT_MS) deny();
    const scopeKey = JSON.stringify(KEYS.map((name) => scope?.[name]));
    let deadlineMs;
    this.ctx.storage.transactionSync(() => {
      const previous = this.readRow();
      if (!previous || previous.state !== WATCHING ||
          previous.scope_key !== scopeKey || now >= previous.deadline_ms ||
          observedAtMs <= previous.last_observed_ms ||
          heartbeatAtMs <= previous.last_heartbeat_ms) deny();
      deadlineMs = heartbeatAtMs + HEARTBEAT_LIMIT_MS;
      this.ctx.storage.sql.exec(
        'UPDATE gatea_watchdog_local SET last_observed_ms=?, ' +
        'last_heartbeat_ms=?, deadline_ms=? WHERE id=1 AND state=?',
        observedAtMs, heartbeatAtMs, deadlineMs, WATCHING
      );
    });
    await this.scheduleOrFailClosed(deadlineMs);
    return this.statusSynthetic();
  }

  // Local synthetic control only. Never exposed through Worker/DO HTTP.
  // Persist an inert state BEFORE cancelling the alarm, so late delivery or
  // interruption cannot re-enable the Watchdog or authorize external actions.
  async stopSynthetic({scope} = {}) {
    this.checkOffline();
    const scopeKey = JSON.stringify(KEYS.map((name) => scope?.[name]));
    this.initialize();
    let wasStopped = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.readRow();
      if (!current || current.scope_key !== scopeKey) deny();
      if (current.state === STOPPED) {
        wasStopped = true;
        return;
      }
      if (![WATCHING, EXPIRED, UNSCHEDULED].includes(current.state)) deny();
      this.ctx.storage.sql.exec(
        'UPDATE gatea_watchdog_local SET state=? WHERE id=1 AND state=?',
        STOPPING, current.state
      );
      if (this.readRow()?.state !== STOPPING) deny();
    });
    if (wasStopped) return this.statusSynthetic();
    try {
      if (typeof this.ctx.storage.deleteAlarm !== 'function') deny();
      await this.ctx.storage.deleteAlarm();
    } catch {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          'UPDATE gatea_watchdog_local SET state=? WHERE id=1 AND state=?',
          CANCEL_FAILED, STOPPING
        );
      });
      // An alarm can still arrive. Both STOPPING and CANCEL_FAILED are inert.
      deny();
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'UPDATE gatea_watchdog_local SET state=? WHERE id=1 AND state=?',
        STOPPED, STOPPING
      );
      if (this.readRow()?.state !== STOPPED) deny();
    });
    return this.statusSynthetic();
  }

  async scheduleOrFailClosed(deadlineMs) {
    try {
      await this.ctx.storage.setAlarm(deadlineMs);
    } catch {
      // The spent challenge remains spent; never treat a missing alarm as armed.
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          'UPDATE gatea_watchdog_local SET state=? WHERE id=1 AND state=?',
          UNSCHEDULED, WATCHING
        );
      });
      deny();
    }
  }

  // Cloudflare invokes DO alarm at least once; duplicates are safe and inert.
  async alarm() {
    this.checkOffline();
    this.initialize();
    const now = this.currentTime();
    const state = this.readRow();
    if (!state || state.state !== WATCHING) return this.statusSynthetic();
    if (now < state.deadline_ms) {
      await this.scheduleOrFailClosed(state.deadline_ms);
      return this.statusSynthetic();
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'UPDATE gatea_watchdog_local SET state=? WHERE id=1 AND state=? ' +
        'AND deadline_ms<=?',
        EXPIRED, WATCHING, now
      );
    });
    // An expired heartbeat is *not* confirmed runner death. No recovery.
    return this.statusSynthetic();
  }

  statusSynthetic() {
    this.checkOffline();
    this.initialize();
    return Object.freeze({
      mode: MODE,
      state: this.readRow()?.state ?? 'NOT_ARMED',
      gateA: 'NO_GO',
      runnerDeathConfirmed: false,
      liveRecoveryAuthorized: false,
      independentZeroCensusVerified: false,
      authorizesMutation: false,
      authorizesPaidCall: false
    });
  }
}
