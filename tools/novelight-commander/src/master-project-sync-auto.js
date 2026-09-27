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

async function collectProjectRoots(page) {
  const roots = new Set();
  const links = page.locator('a[href*="/g/g-p-"]');
  const count = Math.min(await links.count(), 300);
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href').catch(() => null);
    if (!href) continue;
    const root = projectRootFromChatgptUrl(new URL(href, page.url()).toString());
    if (root) roots.add(root);
  }
  return [...roots];
}

async function collectProjectLinkCandidates(page, projectName) {
  const target = normalize(projectName);
  const exact = new Set();
  const contains = new Set();
  const links = page.locator('a[href*="/g/g-p-"]');
  const count = Math.min(await links.count(), 300);
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const href = await link.getAttribute('href').catch(() => null);
    if (!href) continue;
    const root = projectRootFromChatgptUrl(new URL(href, page.url()).toString());
    if (!root) continue;
    const label = normalize([
      await link.innerText().catch(() => ''),
      await link.getAttribute('aria-label').catch(() => ''),
      await link.getAttribute('title').catch(() => '')
    ].filter(Boolean).join(' '));
    if (!label) continue;
    if (label === target) exact.add(root);
    else if (label.includes(target)) contains.add(root);
  }
  if (exact.size === 1) return [...exact][0];
  if (!exact.size && contains.size === 1) return [...contains][0];
  return null;
}

async function probeProjectRoots(context, roots, projectName) {
  const candidates = [...new Set(roots)].slice(0, 40);
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;

  const target = normalize(projectName);
  const scored = [];
  const probe = await context.newPage();
  try {
    for (const root of candidates) {
      await probe.goto(root, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await probe.waitForTimeout(600);
      const title = normalize(await probe.title().catch(() => ''));
      const body = normalize(
        await probe.locator('body').innerText({ timeout: 1200 }).catch(() => '')
      );
      let score = 0;
      if (title.includes(target)) score += 4;
      if (body.includes(target)) score += 2;
      if (body.includes('novelight-master')) score += 8;
      if (score > 0) scored.push([root, score]);
    }
  } finally {
    await probe.close().catch(() => {});
  }

  scored.sort((a, b) => b[1] - a[1]);
  if (scored.length === 1) return scored[0][0];
  if (scored.length > 1 && scored[0][1] > scored[1][1]) return scored[0][0];
  return null;
}

async function discoverProjectFromHome(context, projectName) {
  const page = await context.newPage();
  try {
    await page.goto('https://chatgpt.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(1200);

    const sidebarOpeners = [
      /Open sidebar/i,
      /Show sidebar/i,
      /サイドバーを開く/i,
      /サイドバーを表示/i
    ];
    for (const pattern of sidebarOpeners) {
      const button = page.getByRole('button', { name: pattern }).first();
      if (await button.count() && await button.isVisible().catch(() => false)) {
        await button.click().catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }

    let found = await collectProjectLinkCandidates(page, projectName);
    if (found) return found;

    const expanders = [
      /^(Projects|プロジェクト)$/i,
      /Show more/i,
      /See more/i,
      /もっと見る/i,
      /すべて表示/i
    ];
    for (const pattern of expanders) {
      const targets = [
        page.getByRole('button', { name: pattern }).first(),
        page.getByRole('link', { name: pattern }).first(),
        page.getByText(pattern).first()
      ];
      for (const target of targets) {
        if (!(await target.count())) continue;
        if (!(await target.isVisible().catch(() => false))) continue;
        await target.click().catch(() => {});
        await page.waitForTimeout(700);
        found = await collectProjectLinkCandidates(page, projectName);
        if (found) return found;
      }
    }

    const roots = await collectProjectRoots(page);
    if (roots.length === 1) return roots[0];
    return probeProjectRoots(context, roots, projectName);
  } finally {
    await page.close().catch(() => {});
  }
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

    if (roots.size) {
      const ranked = [...roots.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length === 1) return ranked[0][0];
      if (ranked[0][1] > ranked[1][1] && ranked[0][1] > 0) return ranked[0][0];
    }

    for (const context of browser.contexts()) {
      const fromHome = await discoverProjectFromHome(context, projectName);
      if (fromHome) return fromHome;
    }
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
