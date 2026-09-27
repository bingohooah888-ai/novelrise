import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  MASTER_SYNC_CONFIRMATION,
  isMasterCandidateFileName,
  prepareLatestMaster
} from './master-sync.js';

const DEFAULT_PROJECT_NAME = 'NOVELIGHT';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

function validateProjectUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') {
    throw new Error('projectUrl must be an https://chatgpt.com URL.');
  }
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
  return url;
}

async function ensurePlaywright(repoRoot) {
  const testsRoot = path.join(repoRoot, 'tests', 'e2e');
  const packageJson = path.join(testsRoot, 'package.json');
  const playwrightPackage = path.join(
    testsRoot,
    'node_modules',
    '@playwright',
    'test',
    'package.json'
  );
  if (!existsSync(playwrightPackage)) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const child = spawn(npm, ['--prefix', 'tests/e2e', 'ci'], {
        cwd: repoRoot,
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Playwright dependency install timed out.'));
      }, 300000);
      child.stderr?.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-8000);
      });
      child.on('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0 && existsSync(playwrightPackage)) resolve();
        else reject(new Error('Unable to install locked Playwright dependencies.\n' + stderr));
      });
    });
  }
  const requireFromTests = createRequire(packageJson);
  return requireFromTests('@playwright/test').chromium;
}

async function cdpAvailable(cdpUrl) {
  try {
    const versionUrl = new URL('/json/version', cdpUrl).toString();
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

function debugPortFromUrl(cdpUrl) {
  const explicit = Number(cdpUrl.port || 0);
  if (Number.isInteger(explicit) && explicit > 0 && explicit <= 65535) return explicit;
  return cdpUrl.protocol === 'https:' ? 443 : 80;
}

async function openBrowser(chromium, dataRoot, cdpUrl) {
  if (await cdpAvailable(cdpUrl.toString())) {
    const browser = await chromium.connectOverCDP(cdpUrl.toString());
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('Chrome CDP is reachable but no browser context is available.');
    }
    return {
      context,
      external: true,
      profile: null,
      closeOwned: async () => {}
    };
  }

  const profile = path.join(dataRoot, 'chatgpt-browser-profile');
  await fs.mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      `--remote-debugging-port=${debugPortFromUrl(cdpUrl)}`
    ]
  });
  return {
    context,
    external: false,
    profile,
    closeOwned: async () => context.close()
  };
}

function loginRequired(page) {
  const url = page.url();
  return /auth\.openai\.com|\/auth\//i.test(url);
}

async function discoverProjectPage(context, projectUrl, projectName) {
  const name = String(projectName || DEFAULT_PROJECT_NAME).trim() || DEFAULT_PROJECT_NAME;
  let page = context.pages().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
  if (!page) page = await context.newPage();

  if (projectUrl) {
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  if (loginRequired(page)) return { page, loginRequired: true };
  await page.waitForTimeout(1200);

  if (!projectUrl) {
    const projectLink = page.getByText(name, { exact: true });
    const count = await projectLink.count();
    if (count !== 1) {
      throw new Error(`Unable to uniquely find ChatGPT Project ${JSON.stringify(name)}. Found ${count} exact matches.`);
    }
    await projectLink.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1200);
  }

  if (loginRequired(page)) return { page, loginRequired: true };
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (!bodyText.includes(name)) {
    throw new Error(`Opened ChatGPT page does not visibly identify Project ${JSON.stringify(name)}.`);
  }
  return { page, loginRequired: false };
}

async function openProjectEditor(page) {
  const body = await page.locator('body').innerText().catch(() => '');
  if (/NOVELIGHT-MASTER/i.test(body)) return;

  const directPatterns = [
    /Edit project/i,
    /Project settings/i,
    /プロジェクトを編集/i,
    /プロジェクト設定/i
  ];
  for (const pattern of directPatterns) {
    const button = page.getByRole('button', { name: pattern }).first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(700);
      return;
    }
  }

  const menus = page.locator(
    'button[aria-label*="project" i], button[aria-label*="プロジェクト" i], button[aria-label*="more" i], button[aria-label*="その他" i]'
  );
  const menuCount = Math.min(await menus.count(), 8);
  for (let index = 0; index < menuCount; index += 1) {
    const button = menus.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(300);
    for (const pattern of directPatterns) {
      const item = page.getByText(pattern).first();
      if (await item.count()) {
        await item.click();
        await page.waitForTimeout(700);
        return;
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function collectMasterLabels(page) {
  return page.evaluate(() => {
    const names = new Set();
    for (const node of document.querySelectorAll('body *')) {
      const text = String(node.textContent || '').trim();
      if (!text || text.length > 180 || !/NOVELIGHT-MASTER/i.test(text)) continue;
      for (const line of text.split(/\n+/)) {
        const value = line.trim();
        if (/^NOVELIGHT-MASTER(?:[-_.\s]|$)/i.test(value) && /\.(?:md|txt)$/i.test(value)) {
          names.add(value);
        }
      }
    }
    return [...names];
  });
}

async function uploadMaster(page, file) {
  const direct = page.locator('input[type="file"]');
  if (await direct.count()) {
    await direct.first().setInputFiles(file);
    return true;
  }

  const patterns = [
    /Add files/i,
    /Upload files/i,
    /Add source/i,
    /ファイルを追加/i,
    /ファイルをアップロード/i,
    /アップロード/i
  ];
  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first();
    if (!(await button.count())) continue;
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
    await button.click();
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      return true;
    }
    const input = page.locator('input[type="file"]');
    if (await input.count()) {
      await input.first().setInputFiles(file);
      return true;
    }
  }
  return false;
}

async function deleteFileByLabel(page, fileName) {
  const matches = page.getByText(fileName, { exact: true });
  const count = await matches.count();
  if (count < 1) return false;

  for (let index = 0; index < count; index += 1) {
    const label = matches.nth(index);
    if (!(await label.isVisible().catch(() => false))) continue;
    const row = label.locator('xpath=ancestor::*[(self::div or self::li) and .//button][1]');
    if (!(await row.count())) continue;

    const menu = row.locator(
      'button[aria-label*="more" i], button[aria-label*="options" i], button[aria-label*="menu" i], button[aria-label*="その他" i], button[aria-label*="オプション" i], button[aria-haspopup="menu"]'
    );
    if (!(await menu.count())) continue;

    await menu.last().click();
    await page.waitForTimeout(250);
    const roleTarget = page.getByRole('menuitem', { name: /Delete|Remove|削除|取り除く/i }).first();
    const textTarget = page.getByText(/^(Delete|Remove|削除|取り除く)$/i).first();
    const target = (await roleTarget.count()) ? roleTarget : textTarget;
    if (!(await target.count())) {
      await page.keyboard.press('Escape').catch(() => {});
      continue;
    }
    await target.click();
    await page.waitForTimeout(250);
    const confirm = page.getByRole('button', { name: /^(Delete|Remove|削除|取り除く)$/i }).last();
    if (await confirm.count()) await confirm.click().catch(() => {});
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

export async function syncMasterToChatgptProjectSafely({
  repoRoot,
  dataRoot,
  projectUrl = '',
  projectName = DEFAULT_PROJECT_NAME,
  confirmation,
  cdpUrl = DEFAULT_CDP_URL
}) {
  if (confirmation !== MASTER_SYNC_CONFIRMATION) {
    throw new Error('MASTER sync confirmation mismatch.');
  }
  const repoValue = String(repoRoot || '').trim();
  const dataValue = String(dataRoot || '').trim();
  if (!repoValue || !dataValue) throw new Error('repoRoot and dataRoot are required.');

  const safeProjectUrl = validateProjectUrl(projectUrl);
  const safeCdpUrl = validateLocalCdpUrl(cdpUrl);
  const prepared = await prepareLatestMaster({ repoRoot: repoValue, dataRoot: dataValue });
  const chromium = await ensurePlaywright(path.resolve(repoValue));
  const browser = await openBrowser(chromium, path.resolve(dataValue), safeCdpUrl);
  let keepOwnedBrowserOpen = false;

  try {
    const discovered = await discoverProjectPage(browser.context, safeProjectUrl, projectName);
    const page = discovered.page;
    if (discovered.loginRequired) {
      keepOwnedBrowserOpen = !browser.external;
      return {
        result: 'LOGIN_REQUIRED',
        mutationPerformed: false,
        attachedToExistingBrowser: browser.external,
        dedicatedBrowserKeptOpen: keepOwnedBrowserOpen,
        profile: browser.profile,
        prepared
      };
    }

    await openProjectEditor(page);
    const before = await collectMasterLabels(page);

    const uploaded = await uploadMaster(page, prepared.file);
    if (!uploaded) {
      throw new Error('Could not locate a ChatGPT Project file upload control. No existing MASTER was deleted.');
    }
    await page.waitForTimeout(1500);
    const freshVisible = await page.getByText(prepared.fileName, { exact: true }).count();
    if (freshVisible < 1) {
      throw new Error('Fresh MASTER upload was not visible after upload. No existing MASTER was deleted.');
    }

    const afterUpload = await collectMasterLabels(page);
    const legacy = afterUpload.filter(
      name => name !== prepared.fileName && isMasterCandidateFileName(name)
    );
    const deleteFailures = [];
    for (const name of legacy) {
      const deleted = await deleteFileByLabel(page, name);
      if (!deleted) deleteFailures.push(name);
    }

    const after = await collectMasterLabels(page);
    const staleAfter = after.filter(
      name => name !== prepared.fileName && isMasterCandidateFileName(name)
    );
    if (deleteFailures.length || staleAfter.length) {
      throw new Error(
        'Fresh MASTER is uploaded, but stale MASTER cleanup was incomplete. ' +
        JSON.stringify({ deleteFailures, staleAfter })
      );
    }

    return {
      result: 'PASS',
      mutationPerformed: true,
      attachedToExistingBrowser: browser.external,
      projectName: String(projectName || DEFAULT_PROJECT_NAME),
      projectUrl: page.url(),
      uploaded: prepared.fileName,
      before,
      removed: legacy,
      after,
      prepared
    };
  } finally {
    if (!browser.external && !keepOwnedBrowserOpen) {
      await browser.closeOwned().catch(() => {});
    }
  }
}
