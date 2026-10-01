import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyChatGptPage, extractPluginId, normalizePluginName } from './chatgpt-plugin-bootstrap.js';

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const DEFAULT_PLUGIN_NAME = 'NOVELIGHT NLO';
const DEFAULT_DESCRIPTION = 'NOVELIGHT専用の開発・運用MCP。ローカル環境への安全な実作業経路。';
const DEFAULT_TIMEOUT_MS = 45_000;

async function exists(file) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}

async function run(command, args, cwd, timeoutMs = 180_000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) { settled = true; reject(new Error(`Process timed out after ${timeoutMs}ms.`)); }
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.on('close', code => { clearTimeout(timer); if (!settled) { settled = true; resolve({ code, stdout, stderr }); } });
  });
}

function normalizePlaywrightModule(imported) {
  const candidate = imported?.chromium ? imported : imported?.default;
  if (!candidate?.chromium?.launchPersistentContext) throw new Error('playwright-core chromium API is unavailable.');
  return candidate;
}

async function ensurePlaywright(commanderDir) {
  try { return normalizePlaywrightModule(await import('playwright-core')); }
  catch (firstError) {
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm', 'install', '--package-lock=false', '--ignore-scripts']
      : ['install', '--package-lock=false', '--ignore-scripts'];
    const result = await run(command, args, commanderDir, 300_000);
    if (result.code !== 0) throw new Error(`playwright-core install failed: ${(result.stderr || result.stdout).slice(0, 1200)}`);
    try { return normalizePlaywrightModule(await import('playwright-core')); } catch { throw firstError; }
  }
}

function browserCandidates() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    process.env.NOVELIGHT_CHATGPT_BROWSER_EXECUTABLE,
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
}

async function resolveBrowserExecutable() {
  for (const candidate of browserCandidates()) if (await exists(candidate)) return candidate;
  throw new Error('No supported local Chromium browser was found.');
}

function profileCandidates(browserExecutable) {
  const local = process.env.LOCALAPPDATA || os.homedir();
  const explicit = String(process.env.NOVELIGHT_CHATGPT_BROWSER_USER_DATA_DIR || '').trim();
  if (explicit) return [{ userDataDir: explicit, profileDirectory: process.env.NOVELIGHT_CHATGPT_BROWSER_PROFILE_DIRECTORY || 'Default', source: 'explicit' }];
  const lower = browserExecutable.toLowerCase();
  const candidates = [];
  if (lower.includes('chrome')) candidates.push({ userDataDir: path.join(local, 'Google', 'Chrome', 'User Data'), profileDirectory: 'Default', source: 'chrome-default' });
  if (lower.includes('msedge')) candidates.push({ userDataDir: path.join(local, 'Microsoft', 'Edge', 'User Data'), profileDirectory: 'Default', source: 'edge-default' });
  candidates.push({ userDataDir: path.join(local, 'NOVELIGHT', 'ChatGPTBrowser'), profileDirectory: 'Default', source: 'novelight-dedicated' });
  const seen = new Set();
  return candidates.filter(item => {
    const key = path.resolve(item.userDataDir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function visible(locator, timeout = 1000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}

async function bodyText(scope) {
  return await scope.innerText({ timeout: 5000 }).catch(() => '');
}

async function screenshot(page, diagnosticsDir, name) {
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const file = path.join(diagnosticsDir, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function closeContext(context, timeoutMs = 5000) {
  if (!context) return;
  await Promise.race([
    context.close().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
}

async function pageRequiresLogin(page) {
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  return classifyChatGptPage({ url: page.url(), bodyText: text }) === 'login_required';
}

async function creationScope(page) {
  const dialogs = page.getByRole('dialog');
  const count = await dialogs.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const dialog = dialogs.nth(i);
    if (await visible(dialog, 250)) return dialog;
  }
  return page;
}

async function creationFormReady(page) {
  const scope = await creationScope(page);
  const text = await bodyText(scope);
  const fields = await scope.locator('input, textarea, [role="combobox"]').count().catch(() => 0);
  return fields > 0 && /connection|接続/i.test(text);
}

async function buttonMeta(button) {
  return [
    await button.innerText().catch(() => ''),
    await button.getAttribute('aria-label') || '',
    await button.getAttribute('title') || ''
  ].join(' ').replace(/\s+/g, ' ').trim();
}

async function openCreationForm(page) {
  const buttons = page.locator('button');
  const count = Math.min(await buttons.count().catch(() => 0), 100);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!await visible(button, 200)) continue;
    const meta = await buttonMeta(button);
    if (!/(?:plugin|create|add|new|プラグイン|作成|追加|新規)|^\+$/i.test(meta)) continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(600);
    if (await creationFormReady(page)) return true;
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
}

async function clickMatching(scope, expressions) {
  for (const expression of expressions) {
    const button = scope.getByRole('button', { name: expression }).first();
    if (await visible(button, 500)) { await button.click(); return true; }
    const text = scope.getByText(expression, { exact: false }).first();
    if (await visible(text, 500)) { await text.click(); return true; }
  }
  return false;
}

async function fillMatching(scope, expressions, value) {
  for (const expression of expressions) {
    const byLabel = scope.getByLabel(expression, { exact: false }).first();
    if (await visible(byLabel, 500)) { await byLabel.fill(value); return true; }
    const byPlaceholder = scope.getByPlaceholder(expression, { exact: false }).first();
    if (await visible(byPlaceholder, 500)) { await byPlaceholder.fill(value); return true; }
  }
  return false;
}

async function fillGenericName(scope, value) {
  const inputs = scope.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = inputs.nth(i);
    if (!await visible(item, 250)) continue;
    const meta = [
      await item.getAttribute('aria-label') || '',
      await item.getAttribute('placeholder') || '',
      await item.getAttribute('name') || ''
    ].join(' ');
    if (/description|説明|tunnel|server|url|検索|search/i.test(meta)) continue;
    await item.fill(value).catch(() => {});
    if ((await item.inputValue().catch(() => '')) === value) return true;
  }
  return false;
}

async function fillGenericDescription(scope, value) {
  const area = scope.locator('textarea').first();
  if (!await visible(area, 250)) return false;
  await area.fill(value).catch(() => {});
  return (await area.inputValue().catch(() => '')) === value;
}

async function chooseTunnel(scope, tunnelId) {
  await clickMatching(scope, [/^tunnel$/i, /secure mcp tunnel/i, /トンネル/, /secure.*mcp/i]);
  await new Promise(resolve => setTimeout(resolve, 400));

  if (await fillMatching(scope, [/tunnel id/i, /tunnel/i, /トンネル.*id/i, /トンネル/], tunnelId)) return true;

  const inputs = scope.locator('input:not([type="hidden"]), [role="combobox"]');
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = inputs.nth(i);
    if (!await visible(item, 250)) continue;
    const meta = [
      await item.getAttribute('aria-label') || '',
      await item.getAttribute('placeholder') || '',
      await item.getAttribute('name') || ''
    ].join(' ');
    if (!/tunnel|connection|mcp|server|接続|トンネル/i.test(meta)) continue;
    try {
      await item.fill(tunnelId);
      return true;
    } catch {}
    try {
      await item.click();
      const option = scope.getByRole('option', { name: new RegExp(tunnelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
      if (await visible(option, 700)) { await option.click(); return true; }
    } catch {}
  }

  const combos = scope.getByRole('combobox');
  const comboCount = await combos.count().catch(() => 0);
  for (let i = 0; i < comboCount; i += 1) {
    const combo = combos.nth(i);
    if (!await visible(combo, 250)) continue;
    await combo.click().catch(() => {});
    const exact = scope.getByRole('option', { name: new RegExp(tunnelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if (await visible(exact, 700)) { await exact.click(); return true; }
    const options = scope.getByRole('option');
    const optionCount = await options.count().catch(() => 0);
    if (optionCount === 1 && await visible(options.first(), 300)) { await options.first().click(); return true; }
  }
  return false;
}

async function ensureCreationForm(page, diagnosticsDir) {
  await page.goto(`${CHATGPT_ORIGIN}/plugins`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(1200);
  if (await pageRequiresLogin(page)) return { ok: false, reason: 'login_required' };
  if (await openCreationForm(page)) return { ok: true };

  await page.goto(CHATGPT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(700);
  await clickMatching(page, [/settings/i, /設定/]);
  await page.waitForTimeout(400);
  await clickMatching(page, [/security and login/i, /security/i, /セキュリティ.*ログイン/, /セキュリティ/]);
  await page.waitForTimeout(400);
  const developer = page.getByText(/developer mode|開発者モード/i, { exact: false }).first();
  if (await visible(developer, 1200)) {
    const switches = page.getByRole('switch');
    const count = await switches.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const item = switches.nth(i);
      const label = `${await item.getAttribute('aria-label') || ''} ${await item.getAttribute('name') || ''}`;
      if (/developer mode|開発者モード/i.test(label) && (await item.getAttribute('aria-checked')) !== 'true') {
        await item.click();
        break;
      }
    }
  }

  await page.goto(`${CHATGPT_ORIGIN}/plugins`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(1200);
  if (await pageRequiresLogin(page)) return { ok: false, reason: 'login_required' };
  if (await openCreationForm(page)) return { ok: true };
  await screenshot(page, diagnosticsDir, 'verified-plugin-create-form-not-found');
  return { ok: false, reason: 'plugin_add_not_found' };
}

async function extractPluginIdFromPage(page) {
  let id = extractPluginId(page.url());
  if (id) return id;
  const links = await page.locator('a[href*="plugin_asdk_app_"]').evaluateAll(nodes => nodes.map(node => node.href)).catch(() => []);
  for (const href of links) { id = extractPluginId(href); if (id) return id; }
  return null;
}

async function saveState(stateFile, payload) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export async function bootstrapChatgptPlugin({
  tunnelId,
  pluginName = DEFAULT_PLUGIN_NAME,
  description = DEFAULT_DESCRIPTION,
  commanderDir = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]src$/, ''),
  dataRoot = path.join(process.env.LOCALAPPDATA || os.homedir(), 'NOVELIGHT', 'Commander')
} = {}) {
  const normalizedTunnelId = String(tunnelId || process.env.NOVELIGHT_COMMANDER_TUNNEL_ID || '').trim();
  if (!normalizedTunnelId || normalizedTunnelId.length > 200 || /[\r\n]/.test(normalizedTunnelId)) throw new Error('NOVELIGHT_COMMANDER_TUNNEL_ID is unavailable or invalid.');
  const name = normalizePluginName(pluginName);
  const safeDescription = String(description || DEFAULT_DESCRIPTION).trim().slice(0, 240);
  const { chromium } = await ensurePlaywright(commanderDir);
  const browserExecutable = await resolveBrowserExecutable();
  const diagnosticsDir = path.join(dataRoot, 'chatgpt-plugin-diagnostics');
  const stateFile = path.join(dataRoot, 'chatgpt-plugin.json');

  let lastFailure = null;
  for (const profile of profileCandidates(browserExecutable)) {
    let context;
    try {
      await fs.mkdir(profile.userDataDir, { recursive: true });
      context = await chromium.launchPersistentContext(profile.userDataDir, {
        executablePath: browserExecutable,
        headless: false,
        args: [`--profile-directory=${profile.profileDirectory}`],
        viewport: null,
        timeout: 30_000
      });
      const page = context.pages()[0] || await context.newPage();
      await page.goto(`${CHATGPT_ORIGIN}/plugins`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      await page.waitForTimeout(900);
      if (await pageRequiresLogin(page)) {
        lastFailure = { status: 'login_required', profile: profile.source };
        await screenshot(page, diagnosticsDir, `login-required-${profile.source}`);
        await closeContext(context);
        continue;
      }

      const existing = page.getByText(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), { exact: false }).first();
      if (await visible(existing, 1200)) {
        await existing.click().catch(() => {});
        await page.waitForTimeout(700);
        const pluginId = await extractPluginIdFromPage(page);
        if (pluginId) {
          const install = await clickMatching(page, [/^install$/i, /install plugin/i, /^インストール$/, /プラグイン.*インストール/]);
          const result = { status: 'registered', pluginId, installed: install, profile: profile.source, existing: true };
          await saveState(stateFile, { ...result, pluginName: name, observedAt: new Date().toISOString() });
          await closeContext(context);
          return result;
        }
      }

      const opened = await ensureCreationForm(page, diagnosticsDir);
      if (!opened.ok) {
        lastFailure = { status: opened.reason, profile: profile.source };
        await closeContext(context);
        continue;
      }

      const scope = await creationScope(page);
      let nameFilled = await fillMatching(scope, [/^name$/i, /plugin name/i, /^名前$/, /プラグイン名/], name);
      if (!nameFilled) nameFilled = await fillGenericName(scope, name);
      let descriptionFilled = await fillMatching(scope, [/description/i, /説明/], safeDescription);
      if (!descriptionFilled) descriptionFilled = await fillGenericDescription(scope, safeDescription);
      const tunnelFilled = await chooseTunnel(scope, normalizedTunnelId);

      if (!nameFilled || !tunnelFilled) {
        await screenshot(page, diagnosticsDir, 'verified-connection-form-incomplete');
        lastFailure = {
          status: 'connection_form_incomplete',
          profile: profile.source,
          details: { nameFilled, descriptionFilled, tunnelFilled, verifiedCreationForm: true }
        };
        await closeContext(context);
        continue;
      }

      const created = await clickMatching(scope, [/^create$/i, /^connect$/i, /^save$/i, /^作成$/, /^接続$/, /^保存$/]);
      if (!created) {
        await screenshot(page, diagnosticsDir, 'verified-create-button-not-found');
        lastFailure = { status: 'create_button_not_found', profile: profile.source };
        await closeContext(context);
        continue;
      }
      await page.waitForTimeout(2000);
      const pluginId = await extractPluginIdFromPage(page);
      if (!pluginId) {
        await screenshot(page, diagnosticsDir, 'verified-plugin-id-not-found');
        lastFailure = { status: 'plugin_id_not_found', profile: profile.source };
        await closeContext(context);
        continue;
      }
      const installed = await clickMatching(page, [/^install$/i, /install plugin/i, /^インストール$/, /プラグイン.*インストール/]);
      const result = { status: 'registered', pluginId, installed, profile: profile.source, existing: false };
      await saveState(stateFile, { ...result, pluginName: name, observedAt: new Date().toISOString() });
      await closeContext(context);
      return result;
    } catch (error) {
      lastFailure = { status: 'browser_attempt_failed', profile: profile.source, error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) };
      await closeContext(context);
    }
  }

  const result = lastFailure || { status: 'no_browser_profile_succeeded' };
  await saveState(stateFile, { ...result, pluginName: name, observedAt: new Date().toISOString() });
  return result;
}
