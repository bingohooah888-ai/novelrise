import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function readFile(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('auto sync is loaded by NLO bridge daemon', async () => {
  const text = await readFile('src/github-bridge-daemon.js');
  assert.equal(text.includes("import './master-auto-sync-daemon.js';"), true);
});

test('auto sync follows MASTER content changes', async () => {
  const text = await readFile('src/master-auto-sync-daemon.js');
  assert.equal(text.includes('lastSyncedContentSha256 === prepared.contentSha256'), true);
  assert.equal(text.includes('confirmation: MASTER_SYNC_CONFIRMATION'), true);
  assert.equal(text.includes("DEFAULT_PROJECT_NAME = 'NOVELIGHT'"), true);
  assert.equal(text.includes('DEFAULT_POLL_MS = 2 * 60 * 1000'), true);
});

test('auto sync verifies the Project once per NLO process even when state says synced', async () => {
  const text = await readFile('src/master-auto-sync-daemon.js');
  assert.equal(text.includes('let verifiedThisProcess = false'), true);
  assert.equal(text.includes('verifiedThisProcess &&'), true);
  assert.equal(text.includes('verifiedThisProcess = true'), true);
  assert.equal(text.includes('runtimeVerified: true'), true);
  assert.equal(text.includes('runtimeVerifiedAt:'), true);
});

test('auto sync never launches a visible ChatGPT browser', async () => {
  const watcher = await readFile('src/master-auto-sync-daemon.js');
  const background = await readFile('src/master-project-sync-background.js');
  assert.equal(
    watcher.includes("from './master-project-sync-background.js'"),
    true
  );
  assert.equal(watcher.includes('syncMasterToChatgptProjectInBackground'), true);
  assert.equal(watcher.includes('uiLaunchAllowed: false'), true);
  assert.equal(background.includes('headless: true'), true);
  assert.equal(background.includes('headless: false'), false);
  assert.equal(background.includes("'--no-first-run'"), true);
  assert.equal(background.includes('DEFERRED_PROFILE_BUSY'), true);
});

test('auto sync serializes Project mutations', async () => {
  const watcher = await readFile('src/master-auto-sync-daemon.js');
  const lock = await readFile('src/master-project-sync-lock.js');
  assert.equal(watcher.includes('withMasterProjectSyncLock'), true);
  assert.equal(lock.includes('PROJECT-SYNC.lock'), true);
  assert.equal(lock.includes('PROJECT_SYNC_BUSY'), true);
});
