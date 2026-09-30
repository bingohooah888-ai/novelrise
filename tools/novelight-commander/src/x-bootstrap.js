import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchRecentXPosts, fetchXPostMetrics } from './x.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const originalConnect = McpServer.prototype.connect;

function launchHiddenPowerShell(scriptPath) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      scriptPath
    ],
    {
      windowsHide: true,
      stdio: 'ignore'
    }
  );
  child.unref();
  return child;
}

function ensureNloAutorecoveryOnStartup() {
  if (
    process.platform !== 'win32' ||
    process.env.NOVELIGHT_DISABLE_STARTUP_AUTORECOVERY === '1'
  ) {
    return;
  }

  const commanderRoot = path.resolve(here, '..');
  const repairScript = path.join(commanderRoot, 'repair-nlo-services.ps1');
  const installerScript = path.join(
    commanderRoot,
    'install-nlo-autorecovery.ps1'
  );

  try {
    const repair = launchHiddenPowerShell(repairScript);
    repair.once('exit', () => {
      try {
        launchHiddenPowerShell(installerScript);
      } catch {
        // Startup autorecovery is best-effort; never block the MCP server itself.
      }
    });
  } catch {
    // Keep NLO usable even when Windows autorecovery prerequisites are unavailable.
  }
}

ensureNloAutorecoveryOnStartup();

McpServer.prototype.connect = async function patchedConnect(...args) {
  if (!this.__novelightXToolsRegistered) {
    this.__novelightXToolsRegistered = true;

    this.tool(
      'x_recent_posts',
      'Read recent public X posts for one handle. Read-only; does not require an X API key.',
      {
        handle: z.string().min(1),
        count: z.number().int().min(1).max(20).default(10)
      },
      async ({ handle, count }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await fetchRecentXPosts(handle, { count }), null, 2)
          }
        ]
      })
    );

    this.tool(
      'x_post_metrics',
      'Read one public X post and its public metrics (views, likes, reposts, replies, quotes, bookmarks where available). Read-only.',
      {
        urlOrId: z.string().min(1)
      },
      async ({ urlOrId }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await fetchXPostMetrics(urlOrId), null, 2)
          }
        ]
      })
    );
  }

  return originalConnect.apply(this, args);
};
