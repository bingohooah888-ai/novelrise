// Synthetic-only isolated subprocesses for AI Phase 2 independent-stop proof.
// This file never accesses GitHub, Supabase, Vercel, or any AI provider.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const [role, suppliedDir] = process.argv.slice(2);
const dir = resolve(suppliedDir || '/nonexistent');
const prefix = resolve(tmpdir(), 'novelight-ai-020705-offline-');
const allowed = dir.startsWith(prefix) && !dir.slice(prefix.length).includes(sep);
if (process.env.NOVELIGHT_AI_020705_OFFLINE_ONLY !== '1' || !allowed ||
    !['runner', 'model', 'watchdog'].includes(role)) process.exit(2);

const path = (name) => resolve(dir, name);
const safeRead = async (name) => JSON.parse(await readFile(path(name), 'utf8'));
const safeWrite = async (name, data) => writeFile(path(name), JSON.stringify(data));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (role === 'runner') {
  const tick = () => safeWrite('runner-heartbeat.json', {at: Date.now()})
    .catch(() => process.exit(3));
  await tick();
  setInterval(tick, 35);
} else if (role === 'model') {
  // A synthetic independently living model-like process, NOT a provider call.
  await safeWrite('model-ready.json', {pid: process.pid});
  setInterval(() => {}, 1000);
} else if (role === 'watchdog') {
  let config;
  try {
    config = await safeRead('control.json');
  } catch {
    process.exit(4);
  }
  if (config?.mode !== 'offline-synthetic-only' ||
      !Number.isSafeInteger(config.runnerPid) || config.runnerPid < 1 ||
      !Number.isSafeInteger(config.modelPid) || config.modelPid < 1 ||
      config.runnerPid === config.modelPid ||
      config.runnerPid === process.pid || config.modelPid === process.pid) {
    process.exit(5);
  }
  let observedHeartbeat = false;
  await safeWrite('watchdog-ready.json', {pid: process.pid});
  const tick = async () => {
    let heartbeat;
    try {
      heartbeat = await safeRead('runner-heartbeat.json');
    } catch {
      return;
    }
    if (!Number.isFinite(heartbeat?.at) || heartbeat.at > Date.now()) return;
    observedHeartbeat = true;
    const runnerIsDead = !alive(config.runnerPid);
    if (!observedHeartbeat || !runnerIsDead ||
        Date.now() - heartbeat.at < 250) return;
    try {
      // Simulated independent external stop and cleanup only.
      if (alive(config.modelPid)) process.kill(config.modelPid, 'SIGTERM');
      const original = await safeRead('synthetic-state.json');
      if (original.mode !== 'offline-synthetic-only' ||
          original.paidCalls !== 0 || !existsSync(path('synthetic-fixture.txt'))) {
        process.exit(6);
      }
      await safeWrite('synthetic-state.json', {
        mode: 'offline-synthetic-only', aiEnabled: false,
        budgets: [0, 0, 0, 0], syntheticSessions: 0,
        syntheticRows: 0, paidCalls: 0
      });
      await unlink(path('synthetic-fixture.txt'));
      const after = await safeRead('synthetic-state.json');
      if (after.aiEnabled !== false || after.budgets.some((n) => n !== 0) ||
          after.syntheticSessions !== 0 || after.syntheticRows !== 0 ||
          after.paidCalls !== 0 || existsSync(path('synthetic-fixture.txt'))) {
        process.exit(7);
      }
      await safeWrite('independent-census.json', {
        simulated: true, modelStopRequested: true,
        syntheticResidue: 0, paidRetries: 0
      });
      process.exit(0);
    } catch {
      process.exit(8);
    }
  };
  const interval = setInterval(() => tick().catch(() => process.exit(9)), 50);
  interval.unref();
  // Stay alive without depending on the runner's lifecycle.
  setInterval(() => {}, 1000);
}
