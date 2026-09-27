import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { syncMasterToChatgptProjectSafely as syncBase } from './master-project-sync.js';

const DEFAULT_BACKGROUND_CDP_PORT = 9333;
const CDP_READY_TIMEOUT_MS = 10000;

function backgroundPort() {
  const configured = Number(
    process.env.NOVELIGHT_MASTER_AUTO_SYNC_CDP_PORT || DEFAULT_BACKGROUND_CDP_PORT
  );
  if (!Number.isInteger(configured) || configured < 1024 || configured > 65535) {
    return DEFAULT_BACKGROUND_CDP_PORT;
  }
  return configured;
}

function loadChromium(repoRoot) {
  const packageJson = path.join(repoRoot, 'tests', 'e2e', 'package.json');
  const playwrightPackage = path.join(
    repoRoot,
    'tests',
    'e2e',
    'node_modules',
    '@playwright',
    'test',
    'package.json'
  );
  try {
    const requireFromTests = createRequire(packageJson);
    requireFromTests.resolve('@playwright/test');
    return requireFromTests('@playwright/test').chromium;
  } catch {
    return null;
  }
}

async function waitForCdp(endpoint) {
  const deadline = Date.now() + CDP_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/json/version', endpoint), {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function deferred(result, reason = '') {
  return {
    result,
    mutationPerformed: false,
    backgroundOnly: true,
    reason: String(reason || '').slice(0, 2000)
  };
}

export async function syncMasterToChatgptProjectInBackground(options = {}) {
  const repoRoot = path.resolve(String(options.repoRoot || '').trim());
  const dataRoot = path.resolve(String(options.dataRoot || '').trim());
  if (!String(options.repoRoot || '').trim() || !String(options.dataRoot || '').trim()) {
    throw new Error('repoRoot and dataRoot are required for background MASTER sync.');
  }

  const chromium = loadChromium(repoRoot);
  if (!chromium) {
    return deferred('DEFERRED_PLAYWRIGHT_UNAVAILABLE');
  }

  const profile = path.join(dataRoot, 'chatgpt-browser-profile');
  await fs.mkdir(profile, { recursive: true });
  const port = backgroundPort();
  const endpoint = `http://127.0.0.1:${port}`;

  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: true,
      viewport: null,
      args: [
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
  } catch (error) {
    return deferred(
      'DEFERRED_PROFILE_BUSY',
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    if (!(await waitForCdp(endpoint))) {
      return deferred('DEFERRED_CDP_UNAVAILABLE');
    }

    const result = await syncBase({
      ...options,
      cdpUrl: endpoint
    });
    return {
      ...result,
      backgroundOnly: true
    };
  } finally {
    await context.close().catch(() => {});
  }
}
