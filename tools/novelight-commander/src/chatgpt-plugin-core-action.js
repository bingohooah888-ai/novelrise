import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapChatgptPlugin } from './chatgpt-plugin-bootstrap.js';

const DEFAULT_NAME = 'NOVELIGHT NLO';
const DEFAULT_DESCRIPTION = 'NOVELIGHT専用の開発・運用MCP。ローカル環境への安全な実作業経路。';
const PLUGIN_ID_RE = /^plugin_asdk_app_[A-Za-z0-9_-]+$/;

function exactKeys(value, allowed) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...allowed].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
}

function commanderDataRoot() {
  return path.join(process.env.LOCALAPPDATA || os.homedir(), 'NOVELIGHT', 'Commander');
}

export async function chatgptPluginStatus() {
  const dataRoot = commanderDataRoot();
  const stateFile = path.join(dataRoot, 'chatgpt-plugin.json');
  const diagnosticsDir = path.join(dataRoot, 'chatgpt-plugin-diagnostics');
  let state = null;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch {}
  let diagnostics = [];
  try { diagnostics = (await fs.readdir(diagnosticsDir)).slice(-10); } catch {}
  return {
    registered: Boolean(state?.status === 'registered' && PLUGIN_ID_RE.test(String(state?.pluginId || ''))),
    status: state?.status || 'not_registered',
    pluginId: PLUGIN_ID_RE.test(String(state?.pluginId || '')) ? state.pluginId : null,
    profile: state?.profile || null,
    observedAt: state?.observedAt || null,
    diagnostics
  };
}

export async function actionChatgptPluginStatus(args = {}) {
  if (!exactKeys(args, [])) throw new Error('chatgpt_plugin_status args must be empty.');
  return JSON.stringify(await chatgptPluginStatus(), null, 2);
}

export async function actionChatgptPluginRegister(args = {}, config) {
  if (!exactKeys(args, ['confirmation', 'pluginName', 'description'])) {
    throw new Error('chatgpt_plugin_register args do not match fixed contract.');
  }
  if (args.confirmation !== 'CHAT_APPROVED') throw new Error('CHAT_APPROVED required.');

  const before = await chatgptPluginStatus();
  if (before.registered) return JSON.stringify(before, null, 2);

  const result = await bootstrapChatgptPlugin({
    pluginName: String(args.pluginName || DEFAULT_NAME),
    description: String(args.description || DEFAULT_DESCRIPTION),
    commanderDir: path.join(config.repoRoot, 'tools', 'novelight-commander'),
    dataRoot: commanderDataRoot()
  });
  return JSON.stringify({ ...result, secretsExposed: false, credentialsRead: false, twoFactorBypassed: false }, null, 2);
}
