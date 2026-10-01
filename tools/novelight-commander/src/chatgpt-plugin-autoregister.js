import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapChatgptPlugin } from './chatgpt-plugin-bootstrap.js';

const dataRoot = path.join(process.env.LOCALAPPDATA || os.homedir(), 'NOVELIGHT', 'Commander');
const stateFile = path.join(dataRoot, 'chatgpt-plugin.json');
const lockFile = path.join(dataRoot, 'chatgpt-plugin-autoregister.lock');
const delayMs = Math.max(5_000, Math.min(60_000, Number(process.env.NOVELIGHT_CHATGPT_PLUGIN_START_DELAY_MS || 12_000)));

async function registeredAlready() {
  try {
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    return state?.status === 'registered' && /^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(String(state?.pluginId || ''));
  } catch {
    return false;
  }
}

async function main() {
  if (await registeredAlready()) return;
  await fs.mkdir(dataRoot, { recursive: true });

  let lock;
  try {
    lock = await fs.open(lockFile, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') return;
    throw error;
  }

  try {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    if (await registeredAlready()) return;
    const result = await bootstrapChatgptPlugin();
    if (result?.status !== 'registered') {
      console.error(`[NLO plugin autoregister] ${String(result?.status || 'not_registered')}`);
    }
  } catch (error) {
    console.error(`[NLO plugin autoregister] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await lock?.close().catch(() => {});
    await fs.unlink(lockFile).catch(() => {});
  }
}

await main();
