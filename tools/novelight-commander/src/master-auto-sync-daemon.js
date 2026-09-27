import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MASTER_SYNC_CONFIRMATION, prepareLatestMaster } from './master-sync.js';
import { syncMasterToChatgptProjectSafely } from './master-project-sync-auto.js';
import { withMasterProjectSyncLock } from './master-project-sync-lock.js';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const DEFAULT_PROJECT_NAME = 'NOVELIGHT';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const DEFAULT_POLL_MS = 2 * 60 * 1000;
const MIN_POLL_MS = 60 * 1000;
let running = false;

function bounded(value, limit = 8000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : text.slice(-limit) + '\n[truncated]';
}

async function readJson(file) {
  try {
    return JSON.parse(String(await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

async function loadConfig() {
  const rawConfigPath = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!rawConfigPath) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  const raw = JSON.parse(String(await fs.readFile(path.resolve(rawConfigPath), 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) {
    throw new Error('Bridge repository identity mismatch.');
  }
  const repoRoot = String(raw.repoRoot || '').trim();
  if (!repoRoot) throw new Error('Bridge repoRoot is not configured.');
  return {
    repoRoot: path.resolve(repoRoot),
    dataRoot: path.resolve(String(raw.dataRoot || path.join(os.homedir(), 'Documents', 'NOVELIGHT-Bridge')))
  };
}

function pollIntervalMs() {
  const configured = Number(process.env.NOVELIGHT_MASTER_AUTO_SYNC_INTERVAL_MS || DEFAULT_POLL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, Math.floor(configured));
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const config = await loadConfig();
    const stateFile = path.join(config.dataRoot, 'master-sync', 'AUTO-SYNC.json');
    const state = await readJson(stateFile) || {};
    const prepared = await prepareLatestMaster(config);

    if (
      state.lastSyncedContentSha256 === prepared.contentSha256 &&
      state.projectUrl &&
      state.status === 'synced'
    ) {
      await writeJsonAtomic(stateFile, {
        ...state,
        lastCheckedAt: new Date().toISOString(),
        lastCheckedMainSha: prepared.mainSha,
        lastCheckedContentSha256: prepared.contentSha256
      });
      return;
    }

    const locked = await withMasterProjectSyncLock(config.dataRoot, async () => {
      return syncMasterToChatgptProjectSafely({
        ...config,
        projectName: String(state.projectName || DEFAULT_PROJECT_NAME),
        projectUrl: String(state.projectUrl || ''),
        confirmation: MASTER_SYNC_CONFIRMATION,
        cdpUrl: String(state.cdpUrl || DEFAULT_CDP_URL)
      });
    });

    if (locked.skipped) {
      await writeJsonAtomic(stateFile, {
        ...state,
        status: 'busy',
        lastCheckedAt: new Date().toISOString(),
        lastCheckedMainSha: prepared.mainSha,
        lastCheckedContentSha256: prepared.contentSha256,
        lastError: null
      });
      return;
    }

    const result = locked.value;
    if (result?.result === 'LOGIN_REQUIRED') {
      await writeJsonAtomic(stateFile, {
        ...state,
        status: 'login_required',
        projectName: String(state.projectName || DEFAULT_PROJECT_NAME),
        cdpUrl: String(state.cdpUrl || DEFAULT_CDP_URL),
        lastCheckedAt: new Date().toISOString(),
        lastCheckedMainSha: prepared.mainSha,
        lastCheckedContentSha256: prepared.contentSha256,
        lastError: null
      });
      console.warn('[NLO master-auto-sync] ChatGPT login is required in the NLO browser profile.');
      return;
    }

    if (!result || result.result !== 'PASS') {
      throw new Error('MASTER automatic Project sync did not return PASS.');
    }

    await writeJsonAtomic(stateFile, {
      enabled: true,
      status: 'synced',
      projectName: result.projectName || state.projectName || DEFAULT_PROJECT_NAME,
      projectUrl: result.projectUrl || state.projectUrl || '',
      cdpUrl: String(state.cdpUrl || DEFAULT_CDP_URL),
      lastSyncedAt: new Date().toISOString(),
      lastSyncedMainSha: prepared.mainSha,
      lastSyncedContentSha256: prepared.contentSha256,
      lastCheckedAt: new Date().toISOString(),
      lastCheckedMainSha: prepared.mainSha,
      lastCheckedContentSha256: prepared.contentSha256,
      uploaded: result.uploaded || null,
      remainingMasterFiles: Array.isArray(result.after) ? result.after : [],
      lastError: null
    });
    console.log(
      `[NLO master-auto-sync] synced ${prepared.contentSha256.slice(0, 12)} from ${prepared.mainSha.slice(0, 12)}.`
    );
  } catch (error) {
    try {
      const config = await loadConfig();
      const stateFile = path.join(config.dataRoot, 'master-sync', 'AUTO-SYNC.json');
      const state = await readJson(stateFile) || {};
      await writeJsonAtomic(stateFile, {
        ...state,
        enabled: true,
        status: 'error',
        lastCheckedAt: new Date().toISOString(),
        lastError: bounded(error instanceof Error ? error.stack || error.message : String(error))
      });
    } catch {}
    console.error('[NLO master-auto-sync] tick failed:', error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

void tick();
const timer = setInterval(() => void tick(), pollIntervalMs());
timer.unref?.();
