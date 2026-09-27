import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { syncMasterToChatgptProjectSafely as syncBase } from './master-project-sync.js';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function projectRootFromChatgptUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') return null;
  const match = url.pathname.match(/^\/g\/(g-p-[A-Za-z0-9_-]+)(?:\/|$)/i);
  if (!match) return null;
  url.pathname = `/g/${match[1]}/project`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function validateLocalCdpUrl(value) {
  const raw = String(value || DEFAULT_CDP_URL).trim() || DEFAULT_CDP_URL;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('cdpUrl must use HTTP or HTTPS.');
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('cdpUrl must target localhost only.');
  }
  return url.toString();
}

async function cdpAvailable(cdpUrl) {
  try {
    const response = await fetch(new URL('/json/version', cdpUrl), {
      signal: AbortSignal.timeout(1200)
    });
    return response.ok;
  } catch {
    return false;
  }
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
  if (!existsSync(playwrightPackage)) return null;
  const requireFromTests = createRequire(packageJson);
  return requireFromTests('@playwright/test').chromium;
}

async function discoverOpenProjectUrl({ repoRoot, cdpUrl, projectName }) {
  const endpoint = validateLocalCdpUrl(cdpUrl);
  if (!(await cdpAvailable(endpoint))) return null;
  const chromium = loadChromium(path.resolve(repoRoot));
  if (!chromium) return null;

  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const roots = new Map();
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const root = projectRootFromChatgptUrl(page.url());
        if (!root) continue;
        const title = normalize(await page.title().catch(() => ''));
        const body = normalize(
          await page.locator('body').innerText({ timeout: 800 }).catch(() => '')
        );
        const name = normalize(projectName);
        const score = Number(title.includes(name)) * 2 + Number(body.includes(name));
        const previous = roots.get(root) || -1;
        if (score > previous) roots.set(root, score);
      }
    }

    if (!roots.size) return null;
    const ranked = [...roots.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1) return ranked[0][0];
    if (ranked[0][1] > ranked[1][1] && ranked[0][1] > 0) return ranked[0][0];
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function syncMasterToChatgptProjectSafely(options) {
  const requestedUrl = String(options?.projectUrl || '').trim();
  if (requestedUrl) return syncBase(options);

  const discoveredUrl = await discoverOpenProjectUrl({
    repoRoot: options?.repoRoot,
    cdpUrl: options?.cdpUrl,
    projectName: options?.projectName
  });

  return syncBase({
    ...options,
    projectUrl: discoveredUrl || ''
  });
}
