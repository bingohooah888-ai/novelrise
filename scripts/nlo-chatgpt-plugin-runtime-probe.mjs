import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrapChatgptPlugin } from '../tools/novelight-commander/src/chatgpt-plugin-bootstrap.js';

function resolveTunnelId() {
  const existing = String(process.env.NOVELIGHT_COMMANDER_TUNNEL_ID || '').trim();
  if (existing) return existing;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', '[Environment]::GetEnvironmentVariable("NOVELIGHT_COMMANDER_TUNNEL_ID", "User")'],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not read the locally stored NLO tunnel identifier.');
  const value = String(result.stdout || '').trim();
  if (!value) throw new Error('The locally stored NLO tunnel identifier is unavailable.');
  return value;
}

try {
  const tunnelId = resolveTunnelId();
  process.env.NOVELIGHT_COMMANDER_TUNNEL_ID = tunnelId;
  const result = await bootstrapChatgptPlugin({
    tunnelId,
    pluginName: 'NOVELIGHT NLO',
    description: 'NOVELIGHT専用の開発・運用MCP。ローカル環境への安全な実作業経路。',
    commanderDir: path.join(process.cwd(), 'tools', 'novelight-commander')
  });
  console.log('NOVELIGHT_NLO_PLUGIN_RUNTIME_PROBE ' + JSON.stringify(result));
} catch (error) {
  console.log('NOVELIGHT_NLO_PLUGIN_RUNTIME_PROBE ' + JSON.stringify({
    status: 'error',
    message: error instanceof Error ? error.message : String(error)
  }));
}
