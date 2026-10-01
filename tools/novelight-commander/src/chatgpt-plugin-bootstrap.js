import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const DEFAULT_PLUGIN_NAME = 'NOVELIGHT NLO';
const DEFAULT_DESCRIPTION = 'NOVELIGHT専用の開発・運用MCP。ローカル環境への安全な実作業経路。';
const PLUGIN_ID_RE = /plugin_asdk_app_[A-Za-z0-9_-]+/;
const DEFAULT_TIMEOUT_MS = 45_000;

function existingFile(file) {
  return fs.stat(file).then(stat => stat.isFile()).catch(() => false);
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

export function normalizePluginName(value) {
  const name = String(value || DEFAULT_PLUGIN_NAME).trim();
  if (!name || name.length > 80 || /[\r\n]/.test(name)) throw new Error('Invalid ChatGPT plugin name.');
  return name;
}

export function extractPluginId(value) {
  return String(value || '').match(PLUGIN_ID_RE)?.[0] || null;
}

export function isAllowedChatGptUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  } catch { return false; }
}

export function classifyChatGptPage({ url = '', bodyText = '' } = {}) {
  const text = String(bodyText || '');
  const current = String(url || '');
  if (/\/auth(?:\/|$)|\/login(?:\/|$)/i.test(current) || (/(?:Log in|Sign in|ログイン|サインイン)/i.test(text) && /(?:Sign up|Create account|新規登録|アカウント作成)/i.test(text))) return 'login_required';
  if (extractPluginId(current)) return 'plugin_detail';
  if (/developer mode|開発者モード/i.test(text)) return 'developer_mode_surface';
  if (/plugins|プラグイン/i.test(text)) return 'plugins_surface';
  return 'unknown';
}

function browserCandidates() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    process.env.NOVELIGHT_CHATGPT_BROWSER_EXECUTABLE,
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
}

async function resolveBrowserExecutable() {
  for (const candidate of browserCandidates()) if (await existingFile(candidate)) return candidate;
  throw new Error('No supported local Chromium browser was found.');
}

function profileCandidates(browserExecutable) {
  const local = process.env.LOCALAPPDATA || os.homedir();
  const explicit = String(process.env.NOVELIGHT_CHATGPT_BROWSER_USER_DATA_DIR || '').trim();
  const dedicated = path.join(local, 'NOVELIGHT', 'ChatGPTBrowser');
  const lower = browserExecutable.toLowerCase();
  if (explicit) {
    return [{ userDataDir: explicit, profileDirectory: process.env.NOVELIGHT_CHATGPT_BROWSER_PROFILE_DIRECTORY || 'Default', source: 'explicit' }];
  }
  const candidates = [];
  if (lower.includes('msedge')) candidates.push({ userDataDir: path.join(local, 'Microsoft', 'Edge', 'User Data'), profileDirectory: 'Default', source: 'edge-default' });
  if (lower.includes('chrome')) candidates.push({ userDataDir: path.join(local, 'Google', 'Chrome', 'User Data'), profileDirectory: 'Default', source: 'chrome-default' });
  candidates.push({ userDataDir: dedicated, profileDirectory: 'Default', source: 'novelight-dedicated' });
  const seen = new Set();
  return candidates.filter(item => { const key = path.resolve(item.userDataDir).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function normalizePlaywrightModule(imported) {
  const candidate = imported?.chromium ? imported : imported?.default;
  if (!candidate?.chromium?.launchPersistentContext) {
    throw new Error('playwright-core chromium API is unavailable.');
  }
  return candidate;
}

async function ensurePlaywright(commanderDir) {
  try { return normalizePlaywrightModule(await import('playwright-core')); }
  catch (firstError) {
    const npm = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm', 'install', '--package-lock=false', '--ignore-scripts']
      : ['install', '--package-lock=false', '--ignore-scripts'];
    const result = await run(npm, args, commanderDir, 300_000);
    if (result.code !== 0) throw new Error(`playwright-core install failed: ${(result.stderr || result.stdout).slice(0, 1200)}`);
    try { return normalizePlaywrightModule(await import('playwright-core')); } catch { throw firstError; }
  }
}

async function visible(locator, timeout = 1200) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}

async function clickFirst(page, expressions) {
  for (const expression of expressions) {
    const byRole = page.getByRole('button', { name: expression }).first();
    if (await visible(byRole)) { await byRole.click(); return true; }
    const byText = page.getByText(expression, { exact: false }).first();
    if (await visible(byText)) { await byText.click(); return true; }
  }
  return false;
}

async function fillFirst(page, expressions, value) {
  for (const expression of expressions) {
    const byLabel = page.getByLabel(expression, { exact: false }).first();
    if (await visible(byLabel)) { await byLabel.fill(value); return true; }
    const byPlaceholder = page.getByPlaceholder(expression, { exact: false }).first();
    if (await visible(byPlaceholder)) { await byPlaceholder.fill(value); return true; }
  }
  return false;
}

async function bodyText(page) { return await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''); }

async function screenshot(page, diagnosticsDir, name) {
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const file = path.join(diagnosticsDir, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function ensureDeveloperMode(page, diagnosticsDir) {
  await page.goto(`${CHATGPT_ORIGIN}/plugins`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(1500);
  let text = await bodyText(page);
  if (classifyChatGptPage({ url: page.url(), bodyText: text }) === 'login_required') return { ok: false, reason: 'login_required' };

  const hasAdd = await clickFirst(page, [/^add$/i, /^create$/i, /^new$/i, /add plugin/i, /create plugin/i, /^追加$/, /^作成$/, /^新規$/, /プラグイン.*追加/, /プラグイン.*作成/, /^\+$/]);
  if (hasAdd) return { ok: true, creationDialogOpen: true };

  await page.goto(CHATGPT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(1000);
  await clickFirst(page, [/settings/i, /設定/]);
  await page.waitForTimeout(500);
  await clickFirst(page, [/security and login/i, /security/i, /セキュリティ.*ログイン/, /セキュリティ/]);
  await page.waitForTimeout(500);

  const developerText = page.getByText(/developer mode|開発者モード/i, { exact: false }).first();
  if (await visible(developerText, 2500)) {
    const switches = page.getByRole('switch');
    const count = await switches.count();
    for (let i = 0; i < count; i += 1) {
      const item = switches.nth(i);
      const label = `${await item.getAttribute('aria-label') || ''} ${await item.getAttribute('name') || ''}`;
      if (/developer mode|開発者モード/i.test(label)) {
        if ((await item.getAttribute('aria-checked')) !== 'true') await item.click();
        break;
      }
    }
  }

  await page.goto(`${CHATGPT_ORIGIN}/plugins`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(1500);
  text = await bodyText(page);
  if (classifyChatGptPage({ url: page.url(), bodyText: text }) === 'login_required') return { ok: false, reason: 'login_required' };
  const opened = await clickFirst(page, [/^add$/i, /^create$/i, /^new$/i, /add plugin/i, /create plugin/i, /^追加$/, /^作成$/, /^新規$/, /プラグイン.*追加/, /プラグイン.*作成/, /^\+$/]);
  if (!opened) { await screenshot(page, diagnosticsDir, 'developer-mode-or-plugin-add-not-found'); return { ok: false, reason: 'plugin_add_not_found' }; }
  return { ok: true, creationDialogOpen: true };
}

async function fillConnectionForm(page, { tunnelId, pluginName, description, diagnosticsDir }) {
  await page.waitForTimeout(700);
  const choseTunnel = await clickFirst(page, [/^tunnel$/i, /secure mcp tunnel/i, /トンネル/, /secure.*mcp/i]);
  if (!choseTunnel) await screenshot(page, diagnosticsDir, 'tunnel-choice-not-found');
  const nameFilled = await fillFirst(page, [/^name$/i, /plugin name/i, /^名前$/, /プラグイン名/], pluginName);
  const descriptionFilled = await fillFirst(page, [/description/i, /説明/], description);
  let tunnelFilled = await fillFirst(page, [/tunnel id/i, /tunnel/i, /トンネル.*id/i, /トンネル/], tunnelId);
  if (!tunnelFilled) {
    const combo = page.getByRole('combobox').first();
    if (await visible(combo)) {
      try { await combo.selectOption({ label: tunnelId }); tunnelFilled = true; }
      catch { try { await combo.fill(tunnelId); tunnelFilled = true; } catch {} }
    }
  }
  if (!nameFilled || !tunnelFilled) {
    await screenshot(page, diagnosticsDir, 'connection-form-incomplete');
    return { ok: false, reason: 'connection_form_incomplete', nameFilled, descriptionFilled, tunnelFilled };
  }
  const created = await clickFirst(page, [/^create$/i, /^connect$/i, /^save$/i, /^作成$/, /^接続$/, /^保存$/]);
  if (!created) { await screenshot(page, diagnosticsDir, 'create-button-not-found'); return { ok: false, reason: 'create_button_not_found' }; }
  await page.waitForTimeout(2500);
  return { ok: true };
}

async function extractPluginIdFromPage(page) {
  let id = extractPluginId(page.url());
  if (id) return id;
  const links = await page.locator('a[href*="plugin_asdk_app_"]').evaluateAll(nodes => nodes.map(node => node.href)).catch(() => []);
  for (const href of links) { id = extractPluginId(href); if (id) return id; }
  return null;
}

async function tryInstall(page) { return await clickFirst(page, [/^install$/i, /install plugin/i, /^インストール$/, /プラグイン.*インストール/]); }

async function saveState(stateFile, payload) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function closeContext(context, timeoutMs = 5_000) {
  if (!context) return;
  await Promise.race([
    context.close().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
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
      const pages = context.pages();
      const page = pages[0] || await context.newPage();
      await page.goto(`${CHATGPT_ORIGIN}/plugins`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      await page.waitForTimeout(1200);
      const text = await bodyText(page);
      if (classifyChatGptPage({ url: page.url(), bodyText: text }) === 'login_required') {
        lastFailure = { status: 'login_required', profile: profile.source };
        await screenshot(page, diagnosticsDir, `login-required-${profile.source}`);
        await closeContext(context);
        continue;
      }

      const existing = page.getByText(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), { exact: false }).first();
      if (await visible(existing, 1800)) {
        await existing.click().catch(() => {});
        await page.waitForTimeout(1000);
        const pluginId = await extractPluginIdFromPage(page);
        if (pluginId) {
          const installed = await tryInstall(page);
          const result = { status: 'registered', pluginId, installed, profile: profile.source, existing: true };
          await saveState(stateFile, { ...result, pluginName: name, observedAt: new Date().toISOString() });
          await closeContext(context);
          return result;
        }
      }

      const developer = await ensureDeveloperMode(page, diagnosticsDir);
      if (!developer.ok) { lastFailure = { status: developer.reason, profile: profile.source }; await closeContext(context); continue; }
      const form = await fillConnectionForm(page, { tunnelId: normalizedTunnelId, pluginName: name, description: safeDescription, diagnosticsDir });
      if (!form.ok) { lastFailure = { status: form.reason, profile: profile.source, details: form }; await closeContext(context); continue; }
      const pluginId = await extractPluginIdFromPage(page);
      if (!pluginId) { await screenshot(page, diagnosticsDir, 'plugin-id-not-found-after-create'); lastFailure = { status: 'plugin_id_not_found', profile: profile.source }; await closeContext(context); continue; }
      const installed = await tryInstall(page);
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
