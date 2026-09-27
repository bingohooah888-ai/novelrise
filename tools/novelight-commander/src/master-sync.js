import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const MASTER_SYNC_CONFIRMATION = 'SYNC_CHATGPT_PROJECT_MASTER';
export const MASTER_SOURCE_PATH = 'docs/NOVELIGHT-MASTER.md';
const DEFAULT_PROJECT_NAME = 'NOVELIGHT';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const MASTER_NAME_RE = /^NOVELIGHT-MASTER(?:[-_.\s]|$)/i;

function bounded(value, limit = 12000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : text.slice(-limit) + '\n[truncated]';
}

function run(executable, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: Boolean(options.shell),
      windowsHide: true,
      env: options.env || process.env
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Command timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);
    child.stdout?.on('data', chunk => {
      stdout = bounded(stdout + chunk.toString(), 1000000);
    });
    child.stderr?.on('data', chunk => {
      stderr = bounded(stderr + chunk.toString(), 200000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function isMasterCandidateFileName(name) {
  return MASTER_NAME_RE.test(String(name || '').trim());
}

export function currentMasterFileName(mainSha, contentSha) {
  const main = String(mainSha || '').toLowerCase();
  const content = String(contentSha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(main)) throw new Error('mainSha must be a 40-character SHA.');
  if (!/^[0-9a-f]{64}$/.test(content)) throw new Error('contentSha must be a SHA-256 value.');
  return `NOVELIGHT-MASTER-CURRENT-${main.slice(0, 12)}-${content.slice(0, 12)}.md`;
}

export function validateMasterText(text) {
  const value = String(text || '').replace(/^\uFEFF/u, '');
  const checks = {
    hasTitle: /(^|\n)#?\s*NOVELIGHT MASTER\s*(\n|$)/i.test(value),
    hasUpdatedAt: /最終更新：20\d{2}年\d{1,2}月\d{1,2}日/.test(value),
    hasNloDcSection: /34\.\s*NLO\s*\/\s*DC\s*絶対分離ルール/.test(value),
    hasNloIdentity: /NLO\s*=\s*NOVELIGHT Commander/.test(value),
    hasDcIdentity: /DC\s*=\s*Remote Desktop Commander\s*\/\s*Desktop Commander/.test(value),
    longEnough: value.length >= 10000
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) {
    const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    throw new Error('MASTER validation failed: ' + failed.join(', '));
  }
  return checks;
}

async function git(args, repoRoot, timeoutMs = 120000) {
  const result = await run('git', args, { cwd: repoRoot, timeoutMs });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed.\n${bounded(result.stderr || result.stdout, 8000)}`);
  }
  return result.stdout;
}

export async function prepareLatestMaster({ repoRoot, dataRoot }) {
  const root = path.resolve(String(repoRoot || ''));
  const data = path.resolve(String(dataRoot || ''));
  if (!root || !data) throw new Error('repoRoot and dataRoot are required.');

  await git(['fetch', 'origin', 'main', '--prune'], root);
  const mainSha = (await git(['rev-parse', 'origin/main'], root)).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(mainSha)) throw new Error('origin/main did not resolve to a commit SHA.');

  const text = await git(['show', `${mainSha}:${MASTER_SOURCE_PATH}`], root);
  validateMasterText(text);
  const contentSha = sha256(text);
  const fileName = currentMasterFileName(mainSha, contentSha);
  const directory = path.join(data, 'master-sync');
  const file = path.join(directory, fileName);
  const manifest = path.join(directory, 'CURRENT.json');
  await fs.mkdir(directory, { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, file);
  const payload = {
    preparedAt: new Date().toISOString(),
    source: `origin/main:${MASTER_SOURCE_PATH}`,
    mainSha,
    contentSha256: contentSha,
    fileName,
    file,
    bytes: Buffer.byteLength(text, 'utf8')
  };
  const manifestTemp = manifest + '.tmp';
  await fs.writeFile(manifestTemp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.rename(manifestTemp, manifest);
  return payload;
}

function validateProjectUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') {
    throw new Error('projectUrl must be an https://chatgpt.com URL.');
  }
  return url.toString();
}

async function ensurePlaywright(repoRoot) {
  const testsRoot = path.join(repoRoot, 'tests', 'e2e');
  const packageJson = path.join(testsRoot, 'package.json');
  const playwrightPackage = path.join(testsRoot, 'node_modules', '@playwright', 'test', 'package.json');
  if (!existsSync(playwrightPackage)) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = await run(npm, ['--prefix', 'tests/e2e', 'ci'], {
      cwd: repoRoot,
      timeoutMs: 300000,
      shell: process.platform === 'win32'
    });
    if (result.code !== 0 || !existsSync(playwrightPackage)) {
      throw new Error('Unable to install locked Playwright dependencies.\n' + bounded(result.stderr || result.stdout, 8000));
    }
  }
  const requireFromTests = createRequire(packageJson);
  return requireFromTests('@playwright/test').chromium;
}

async function cdpAvailable(cdpUrl) {
  try {
    const url = new URL('/json/version', cdpUrl).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function openBrowser(chromium, dataRoot, cdpUrl) {
  if (await cdpAvailable(cdpUrl)) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close().catch(() => {});
      throw new Error('Chrome CDP is reachable but no browser context is available.');
    }
    return { browser, context, launched: false, close: () => browser.close() };
  }

  const profile = path.join(dataRoot, 'chatgpt-browser-profile');
  await fs.mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  });
  return { browser: null, context, launched: true, profile, close: () => context.close() };
}

function loginRequired(page) {
  const url = page.url();
  return /auth\.openai\.com|\/auth\//i.test(url);
}

async function discoverProjectPage(context, projectUrl, projectName) {
  const name = String(projectName || DEFAULT_PROJECT_NAME).trim() || DEFAULT_PROJECT_NAME;
  let page = null;
  const existing = context.pages();
  for (const candidate of existing) {
    if (candidate.url().startsWith('https://chatgpt.com/')) {
      page = candidate;
      break;
    }
  }
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

  const candidates = [
    /Edit project/i,
    /Project settings/i,
    /プロジェクトを編集/i,
    /プロジェクト設定/i
  ];
  for (const pattern of candidates) {
    const button = page.getByRole('button', { name: pattern }).first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(700);
      return;
    }
  }

  const menus = page.locator('button[aria-label*="project" i], button[aria-label*="プロジェクト" i], button[aria-label*="more" i], button[aria-label*="その他" i]');
  const menuCount = Math.min(await menus.count(), 8);
  for (let index = 0; index < menuCount; index += 1) {
    const button = menus.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(300);
    for (const pattern of candidates) {
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

async function setFileInput(page, file) {
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

    const preferred = row.locator('button[aria-label*="more" i], button[aria-label*="options" i], button[aria-label*="menu" i], button[aria-label*="その他" i], button[aria-label*="オプション" i], button[aria-haspopup="menu"]');
    let menuButton = null;
    if (await preferred.count()) menuButton = preferred.last();
    else {
      const buttons = row.locator('button');
      if (await buttons.count()) menuButton = buttons.last();
    }
    if (!menuButton) continue;

    await menuButton.click();
    await page.waitForTimeout(250);
    const remove = page.getByRole('menuitem', { name: /Delete|Remove|削除|取り除く/i }).first();
    const fallback = page.getByText(/^(Delete|Remove|削除|取り除く)$/i).first();
    const target = (await remove.count()) ? remove : fallback;
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

export async function syncMasterToChatgptProject({
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
  const safeProjectUrl = validateProjectUrl(projectUrl);
  const prepared = await prepareLatestMaster({ repoRoot, dataRoot });
  const chromium = await ensurePlaywright(path.resolve(repoRoot));
  const browser = await openBrowser(chromium, path.resolve(dataRoot), String(cdpUrl || DEFAULT_CDP_URL));
  let page;
  try {
    const discovered = await discoverProjectPage(browser.context, safeProjectUrl, projectName);
    page = discovered.page;
    if (discovered.loginRequired) {
      return {
        result: 'LOGIN_REQUIRED',
        mutationPerformed: false,
        launchedDedicatedProfile: browser.launched,
        profile: browser.profile || null,
        prepared
      };
    }

    await openProjectEditor(page);
    const before = await collectMasterLabels(page);

    const uploaded = await setFileInput(page, prepared.file);
    if (!uploaded) {
      throw new Error('Could not locate a ChatGPT Project file upload control. No existing MASTER was deleted.');
    }
    await page.waitForTimeout(1200);
    const freshVisible = await page.getByText(prepared.fileName, { exact: true }).count();
    if (freshVisible < 1) {
      throw new Error('Fresh MASTER upload was not visible after upload. No existing MASTER was deleted.');
    }

    const legacy = (await collectMasterLabels(page)).filter(name => name !== prepared.fileName);
    const deleteFailures = [];
    for (const name of legacy) {
      if (!isMasterCandidateFileName(name)) continue;
      const deleted = await deleteFileByLabel(page, name);
      if (!deleted) deleteFailures.push(name);
    }

    const after = await collectMasterLabels(page);
    const staleAfter = after.filter(name => name !== prepared.fileName && isMasterCandidateFileName(name));
    if (deleteFailures.length || staleAfter.length) {
      throw new Error(
        'Fresh MASTER is uploaded, but stale MASTER cleanup was incomplete. ' +
        JSON.stringify({ deleteFailures, staleAfter })
      );
    }

    return {
      result: 'PASS',
      mutationPerformed: true,
      projectName: String(projectName || DEFAULT_PROJECT_NAME),
      projectUrl: page.url(),
      uploaded: prepared.fileName,
      before,
      removed: legacy.filter(isMasterCandidateFileName),
      after,
      prepared
    };
  } finally {
    if (browser.launched) {
      await browser.close().catch(() => {});
    } else if (browser.browser) {
      await browser.browser.close().catch(() => {});
    }
  }
}
