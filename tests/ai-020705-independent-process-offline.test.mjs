import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const fixture = new URL('./fixtures/ai-020705-independent-process-offline.mjs', import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const get = async (file) => JSON.parse(await readFile(file, 'utf8'));
const alive = (processHandle) => processHandle.exitCode === null &&
  processHandle.signalCode === null;

async function until(predicate, label, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await sleep(35);
  }
  throw new Error('Synthetic process fixture timed out: ' + label);
}

function child(role, directory) {
  return spawn(process.execPath, [fixture.pathname, role, directory], {
    env: {...process.env, NOVELIGHT_AI_020705_OFFLINE_ONLY: '1'},
    stdio: 'ignore'
  });
}

test('independent watchdog survives SIGKILL of runner, stops separate model and verifies synthetic zero census',
  {timeout: 12000, skip: process.platform === 'win32'}, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novelight-ai-020705-offline-'));
    const state = join(directory, 'synthetic-state.json');
    const fixtureFile = join(directory, 'synthetic-fixture.txt');
    const census = join(directory, 'independent-census.json');
    const processes = [];
    try {
      await writeFile(state, JSON.stringify({
        mode: 'offline-synthetic-only', aiEnabled: true,
        budgets: [1, 1, 1, 1], syntheticSessions: 1,
        syntheticRows: 1, paidCalls: 0
      }));
      await writeFile(fixtureFile, 'SYNTHETIC ONLY');
      const model = child('model', directory);
      processes.push(model);
      const runner = child('runner', directory);
      processes.push(runner);
      await until(() => existsSync(join(directory, 'model-ready.json')) &&
        existsSync(join(directory, 'runner-heartbeat.json')), 'fixture ready');
      await writeFile(join(directory, 'control.json'), JSON.stringify({
        mode: 'offline-synthetic-only', runnerPid: runner.pid, modelPid: model.pid
      }));
      const watchdog = child('watchdog', directory);
      processes.push(watchdog);
      await until(() => existsSync(join(directory, 'watchdog-ready.json')), 'watchdog ready');
      assert.notEqual(watchdog.pid, runner.pid);
      assert.notEqual(watchdog.pid, model.pid);
      await sleep(350);
      assert.equal(existsSync(census), false, 'must not stop a healthy runner');
      assert.equal(alive(watchdog), true, 'independent watchdog is still alive');
      runner.kill('SIGKILL');
      await until(() => existsSync(census), 'external recovery');
      await until(() => !alive(model), 'external model stop');
      assert.equal((await get(state)).aiEnabled, false);
      assert.deepEqual((await get(state)).budgets, [0, 0, 0, 0]);
      assert.equal((await get(state)).syntheticSessions, 0);
      assert.equal((await get(state)).syntheticRows, 0);
      assert.equal((await get(state)).paidCalls, 0);
      assert.equal(existsSync(fixtureFile), false);
      assert.deepEqual(await get(census), {
        simulated: true, modelStopRequested: true,
        syntheticResidue: 0, paidRetries: 0
      });
    } finally {
      for (const p of processes) if (alive(p)) p.kill('SIGKILL');
      await rm(directory, {recursive: true, force: true});
    }
  });
